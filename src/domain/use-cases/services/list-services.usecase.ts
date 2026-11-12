import GetServerConnectionUseCase from '@/domain/use-cases/ssh/get-server-connection.usecase.js'
import { listServicesScript, SERVICES_MARKER } from '@/infrastructure/ssh/scripts/list-services.script.js'
import type SshCommandRunner from '@/infrastructure/ssh/ssh-command.runner.js'
import { sshCommandRunner } from '@/infrastructure/ssh/ssh-command.runner.js'
import SshConnectionError from '@/shared/errors/ssh-connection.error.js'
import {
  SERVICE_SUFFIX,
  type ServiceStartup,
  type ServiceStatus,
  toServiceStartup,
  toServiceStatus,
} from './service.rules.js'

// --> Failed services first: they are what the member is looking for
const STATUS_ORDER: Record<ServiceStatus, number> = {
  failed: 0,
  running: 1,
  starting: 2,
  stopping: 3,
  exited: 4,
  stopped: 5,
}

interface ListServicesRequest {
  // --> EnsurePermissionHook already checked it belongs to the organization and the member can access it
  serverId: string
  // --> Only the services with this status, the summary always counts all of them
  status?: ServiceStatus | undefined
}

interface Service {
  // --> Without ".service"
  name: string
  // --> null when the service is not loaded: systemd only knows its file
  description: string | null
  status: ServiceStatus
  // --> The raw state of systemd: running, exited, dead, failed, auto-restart ...
  subState: string
  // --> How it starts at boot, null when systemd has no file for it (created while the server runs)
  startup: ServiceStartup | null
}

interface ListServicesResponse {
  summary: {
    total: number
    running: number
    failed: number
  }
  services: Service[]
}

// --> systemd services of a server with their state, read with one script that needs no sudo
export default class ListServicesUseCase {
  constructor(
    private readonly getServerConnection: GetServerConnectionUseCase = new GetServerConnectionUseCase(),
    private readonly commandRunner: SshCommandRunner = sshCommandRunner,
  ) {}

  public async execute({ serverId, status }: ListServicesRequest): Promise<ListServicesResponse> {
    // --> get the connection of the server and run the script
    const connection = await this.getServerConnection.execute({ serverId })

    const { stdout } = await this.commandRunner.runScript(connection, listServicesScript())

    // --> split the output into its parts: name -> lines
    const parts = new Map<string, string[]>()

    for (const part of stdout.split(SERVICES_MARKER).slice(1)) {
      const [name = '', ...lines] = part.split('\n')

      parts.set(name.trim(), lines)
    }

    if (parts.has('NO_SYSTEMD')) {
      throw new SshConnectionError('SYSTEMD_NOT_AVAILABLE', 'This server does not use systemd to manage its services')
    }

    const unitLines = parts.get('UNITS')
    const unitFileLines = parts.get('UNIT_FILES')

    // --> without the last marker the output was cut
    if (unitLines === undefined || unitFileLines === undefined || !parts.has('END')) {
      throw new SshConnectionError('SSH_COMMAND_FAILED', 'The server did not return its services')
    }

    // --> parse unit files, a line is "name.service state preset"
    const startupOfUnit = new Map<string, ServiceStartup>()
    const aliases = new Set<string>()

    for (const line of unitFileLines) {
      const [unit, state] = line.trim().split(/\s+/)

      if (!unit?.endsWith(SERVICE_SUFFIX) || !state) {
        continue
      }

      // --> an alias is a second name of another service, listing it would show the service twice
      if (state === 'alias') {
        aliases.add(unit)
        continue
      }

      startupOfUnit.set(unit, toServiceStartup(state))
    }

    // --> parse units, a line is "name.service load active sub description"
    const services = new Map<string, Service>()

    for (const line of unitLines) {
      // --> some systemd versions print a bullet before a failed unit
      const fields = line
        .trim()
        .replace(/^[●*]\s*/, '')
        .split(/\s+/)
      const [unit, load, active, sub, ...description] = fields

      if (!unit?.endsWith(SERVICE_SUFFIX) || !load || !active || !sub) {
        continue
      }

      // --> "not-found" is a name another service asks for, no such service is installed
      if (load === 'not-found' || aliases.has(unit)) {
        continue
      }

      // --> "getty@tty1.service" is started from the template "getty@.service", it starts at boot like its template
      const template = unit.replace(/@.+\.service$/, `@${SERVICE_SUFFIX}`)

      services.set(unit, {
        name: unit.slice(0, -SERVICE_SUFFIX.length),
        // --> systemd repeats the name when it knows no description, like for a masked service
        description: description.length > 0 && description.join(' ') !== unit ? description.join(' ') : null,
        status: toServiceStatus(active, sub),
        subState: sub,
        startup: startupOfUnit.get(unit) ?? startupOfUnit.get(template) ?? null,
      })
    }

    // --> add the installed services that are not loaded: they are stopped
    for (const [unit, startup] of startupOfUnit) {
      // --> "getty@.service" is a template, not a service that can run
      if (services.has(unit) || unit.endsWith(`@${SERVICE_SUFFIX}`)) {
        continue
      }

      services.set(unit, {
        name: unit.slice(0, -SERVICE_SUFFIX.length),
        description: null,
        status: 'stopped',
        subState: 'dead',
        startup,
      })
    }

    // --> failed first, then running, then the others, each group sorted by name
    const allServices = [...services.values()].sort((first, second) => {
      const byStatus = STATUS_ORDER[first.status] - STATUS_ORDER[second.status]

      return byStatus !== 0 ? byStatus : first.name.localeCompare(second.name)
    })

    return {
      summary: {
        total: allServices.length,
        running: allServices.filter((service) => service.status === 'running').length,
        failed: allServices.filter((service) => service.status === 'failed').length,
      },
      services: status ? allServices.filter((service) => service.status === status) : allServices,
    }
  }
}
