import GetServerConnectionUseCase from '@/domain/use-cases/ssh/get-server-connection.usecase.js'
import { getServiceScript } from '@/infrastructure/ssh/scripts/get-service.script.js'
import { SERVICES_MARKER } from '@/infrastructure/ssh/scripts/list-services.script.js'
import type SshCommandRunner from '@/infrastructure/ssh/ssh-command.runner.js'
import { sshCommandRunner } from '@/infrastructure/ssh/ssh-command.runner.js'
import NotFoundError from '@/shared/errors/not-found.error.js'
import SshConnectionError from '@/shared/errors/ssh-connection.error.js'
import ValidationError from '@/shared/errors/validation.error.js'
import {
  SERVICE_NAME_PATTERN,
  SERVICE_SUFFIX,
  type ServiceStartup,
  type ServiceStatus,
  toServiceStartup,
  toServiceStatus,
} from './service.rules.js'

// --> What systemd prints for a number it does not measure: the biggest 64 bit number
const NOT_MEASURED = '18446744073709551615'

interface GetServiceRequest {
  // --> EnsurePermissionHook already checked it belongs to the organization and the member can access it
  serverId: string
  // --> Without ".service"
  name: string
}

interface GetServiceResponse {
  name: string
  description: string | null
  status: ServiceStatus
  subState: string
  startup: ServiceStartup | null
  // --> null when the service is not running
  process: {
    pid: number
    startedAt: string | null
    // --> The three are null when the server does not measure them
    memoryBytes: number | null
    cpuSeconds: number | null
    tasks: number | null
  } | null
  // --> How many times systemd started it again by itself, null on old systemd versions
  restarts: number | null
  // --> How its process ended the last time, null when it never ended
  lastExit: {
    // --> success, exit-code, signal, timeout, oom-kill, core-dump ...
    result: string
    exitCode: number | null
    at: string
  } | null
  config: {
    unitFile: string | null
    command: string | null
    user: string
    workingDirectory: string | null
    // --> no, on-failure, always ...
    restartPolicy: string | null
  }
}

// --> Details of one systemd service, read with one script that needs no sudo
export default class GetServiceUseCase {
  constructor(
    private readonly getServerConnection: GetServerConnectionUseCase = new GetServerConnectionUseCase(),
    private readonly commandRunner: SshCommandRunner = sshCommandRunner,
  ) {}

  public async execute({ serverId, name }: GetServiceRequest): Promise<GetServiceResponse> {
    // --> the name is checked here too, whatever the caller already did: it reaches a command on the server
    if (!SERVICE_NAME_PATTERN.test(name)) {
      throw new ValidationError('Not a valid service name')
    }

    // --> get the connection of the server and run the script, the name goes to its input
    const connection = await this.getServerConnection.execute({ serverId })

    const { stdout } = await this.commandRunner.runScript(connection, getServiceScript({ name }))

    const lines = stdout.split('\n').map((line) => line.trimEnd())

    if (lines.includes(`${SERVICES_MARKER}NO_SYSTEMD`)) {
      throw new SshConnectionError('SYSTEMD_NOT_AVAILABLE', 'This server does not use systemd to manage its services')
    }

    // --> without the last marker the output was cut
    if (!lines.includes(`${SERVICES_MARKER}SHOW`) || !lines.includes(`${SERVICES_MARKER}END`)) {
      throw new SshConnectionError('SSH_COMMAND_FAILED', 'The server did not return the service')
    }

    // --> parse the values, a line is "Key=value". A key can come twice, the first one is kept
    const values = new Map<string, string>()

    for (const line of lines) {
      const separator = line.indexOf('=')
      const key = line.slice(0, separator)

      if (separator > 0 && !values.has(key)) {
        values.set(key, line.slice(separator + 1))
      }
    }

    const value = (key: string): string => values.get(key) ?? ''

    // --> systemd answers for any name, "not-found" means no such service is installed
    // a name ending with "@" is a template, not a service that can run
    if (value('LoadState') === 'not-found' || value('LoadState') === '' || name.endsWith('@')) {
      throw new NotFoundError('Service not found')
    }

    const id = value('Id')
    const pid = this.toNumber(value('MainPID')) ?? 0
    const cpuNanoseconds = this.toNumber(value('CPUUsageNSec'))
    const exitedAt = this.toDate(value('ExecMainExitTimestamp'))

    // --> ExecStart is "{ path=... ; argv[]=the command ; ignore_errors=no ; ... }"
    const command = /argv\[\]=(.*?) ; ignore_errors=/.exec(value('ExecStart'))?.[1] ?? null

    return {
      // --> the real name of the service: the one asked for can be a second name of it (alias)
      name: id.endsWith(SERVICE_SUFFIX) ? id.slice(0, -SERVICE_SUFFIX.length) : name,
      // --> systemd repeats the name when it knows no description, like for a masked service
      description: value('Description') !== '' && value('Description') !== id ? value('Description') : null,
      status: toServiceStatus(value('ActiveState'), value('SubState')),
      subState: value('SubState'),
      startup: value('UnitFileState') !== '' ? toServiceStartup(value('UnitFileState')) : null,
      process:
        pid > 0
          ? {
              pid,
              startedAt: this.toDate(value('ExecMainStartTimestamp')),
              memoryBytes: this.toNumber(value('MemoryCurrent')),
              cpuSeconds: cpuNanoseconds === null ? null : Math.round(cpuNanoseconds / 1e7) / 100,
              tasks: this.toNumber(value('TasksCurrent')),
            }
          : null,
      restarts: this.toNumber(value('NRestarts')),
      lastExit: exitedAt
        ? {
            result: value('Result'),
            exitCode: this.toNumber(value('ExecMainStatus')),
            at: exitedAt,
          }
        : null,
      config: {
        unitFile: value('FragmentPath') || null,
        command,
        // --> a service without "User=" runs as root
        user: value('User') || 'root',
        workingDirectory: value('WorkingDirectory').replace(/^[!-]+/, '') || null,
        restartPolicy: value('Restart') || null,
      },
    }
  }

  // --> null for "[not set]", an empty value, and the number systemd prints when it does not measure
  private toNumber(text: string): number | null {
    return /^\d+$/.test(text) && text !== NOT_MEASURED ? Number(text) : null
  }

  // --> "Fri 2026-10-09 08:12:44 UTC" to an ISO date, null for an empty value or "n/a"
  private toDate(text: string): string | null {
    const match = /(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC$/.exec(text)

    return match ? `${match[1]}T${match[2]}.000Z` : null
  }
}
