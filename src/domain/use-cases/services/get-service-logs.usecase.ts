import GetServerConnectionUseCase from '@/domain/use-cases/ssh/get-server-connection.usecase.js'
import { getServiceLogsScript } from '@/infrastructure/ssh/scripts/get-service-logs.script.js'
import { SERVICES_MARKER } from '@/infrastructure/ssh/scripts/list-services.script.js'
import type SshCommandRunner from '@/infrastructure/ssh/ssh-command.runner.js'
import { sshCommandRunner } from '@/infrastructure/ssh/ssh-command.runner.js'
import NotFoundError from '@/shared/errors/not-found.error.js'
import SshConnectionError from '@/shared/errors/ssh-connection.error.js'
import ValidationError from '@/shared/errors/validation.error.js'
import { SERVICE_NAME_PATTERN } from './service.rules.js'

export const MAX_LOG_LINES = 1000

interface GetServiceLogsRequest {
  // --> EnsurePermissionHook already checked it belongs to the organization and the member can access it
  serverId: string
  // --> Without ".service"
  name: string
  // --> How many lines to read from the end
  lines: number
  // --> Sudo password of the account on the server, only for an account whose sudo asks for one. Never saved
  sudoPassword?: string | undefined
}

interface LogLine {
  at: string
  message: string
}

interface GetServiceLogsResponse {
  name: string
  // --> The oldest line first
  logs: LogLine[]
}

// --> Last log lines of one systemd service, from the journal of the server
// the account needs root rights, or to be in a group that can read the journal
export default class GetServiceLogsUseCase {
  constructor(
    private readonly getServerConnection: GetServerConnectionUseCase = new GetServerConnectionUseCase(),
    private readonly commandRunner: SshCommandRunner = sshCommandRunner,
  ) {}

  public async execute({
    serverId,
    name,
    lines,
    sudoPassword,
  }: GetServiceLogsRequest): Promise<GetServiceLogsResponse> {
    // --> both values are checked here too, whatever the caller already did: they reach a command on the server
    if (!SERVICE_NAME_PATTERN.test(name)) {
      throw new ValidationError('Not a valid service name')
    }

    if (!Number.isInteger(lines) || lines < 1 || lines > MAX_LOG_LINES) {
      throw new ValidationError(`The number of lines must be between 1 and ${MAX_LOG_LINES}`)
    }

    // --> get the connection of the server and run the script, the values go to its input
    const connection = await this.getServerConnection.execute({ serverId })

    const { stdout } = await this.commandRunner.runScript(connection, {
      ...getServiceLogsScript({ name, lines }),
      sudoPassword,
    })

    const output = stdout.split('\n').map((line) => line.trimEnd())

    if (output.includes(`${SERVICES_MARKER}NO_SYSTEMD`)) {
      throw new SshConnectionError('SYSTEMD_NOT_AVAILABLE', 'This server does not use systemd to manage its services')
    }

    // --> systemd answers for any name, "not-found" means no such service is installed
    if (output.includes('LoadState=not-found') || name.endsWith('@')) {
      throw new NotFoundError('Service not found')
    }

    // --> the logs are everything after the first "LOGS" marker, without the last marker the output was cut
    const start = output.indexOf(`${SERVICES_MARKER}LOGS`)

    if (start === -1 || output.findLast((line) => line !== '') !== `${SERVICES_MARKER}END`) {
      throw new SshConnectionError('SSH_COMMAND_FAILED', 'The server did not return the logs')
    }

    // --> parse the logs, each line is one JSON object: anything else is skipped
    const logs: LogLine[] = []

    for (const line of output.slice(start + 1)) {
      const entry = this.parseEntry(line)

      if (entry) {
        logs.push(entry)
      }
    }

    return { name, logs }
  }

  private parseEntry(line: string): LogLine | null {
    if (!line.startsWith('{')) {
      return null
    }

    try {
      const entry = JSON.parse(line) as { __REALTIME_TIMESTAMP?: unknown; MESSAGE?: unknown }

      // --> the time is a number of microseconds, written as text
      const microseconds = Number(entry.__REALTIME_TIMESTAMP)

      if (!Number.isFinite(microseconds) || microseconds <= 0) {
        return null
      }

      // --> a message that is not plain text comes as a list of bytes, a very long one comes as null
      const message = Array.isArray(entry.MESSAGE)
        ? Buffer.from(entry.MESSAGE as number[]).toString('utf8')
        : String(entry.MESSAGE ?? '')

      return {
        at: new Date(microseconds / 1000).toISOString(),
        message,
      }
    } catch {
      return null
    }
  }
}
