import GetServerConnectionUseCase from '@/domain/use-cases/ssh/get-server-connection.usecase.js'
import {
  type ChangeFirewallRulesScriptInput,
  changeFirewalldRulesScript,
  changeUfwRulesScript,
} from '@/infrastructure/ssh/scripts/change-firewall-rules.script.js'
import { FIREWALL_MARKER } from '@/infrastructure/ssh/scripts/get-firewall.script.js'
import type SshCommandRunner from '@/infrastructure/ssh/ssh-command.runner.js'
import type { CommandResult } from '@/infrastructure/ssh/ssh-command.runner.js'
import { sshCommandRunner } from '@/infrastructure/ssh/ssh-command.runner.js'
import type SshConnectionManager from '@/infrastructure/ssh/ssh-connection.manager.js'
import { sshConnectionManager } from '@/infrastructure/ssh/ssh-connection.manager.js'
import ConflictError from '@/shared/errors/conflict.error.js'
import FirewallError from '@/shared/errors/firewall.error.js'
import SshConnectionError from '@/shared/errors/ssh-connection.error.js'
import Logger from '@/shared/logger.js'

// --> How long the server waits for the panel to confirm a change, before it undoes it by itself
export const FIREWALL_ROLLBACK_SECONDS = 60

// --> Servers with a change running in this instance of the app: two changes at once would share one undo
const serversBeingChanged = new Set<string>()

interface RunFirewallChangeRequest {
  serverId: string
  backend: 'ufw' | 'firewalld'
  change: Omit<ChangeFirewallRulesScriptInput, 'phase' | 'timeoutSeconds'>
  // --> Sudo password of the account on the server, only for an account whose sudo asks for one. Never saved
  sudoPassword?: string | undefined
}

// --> Changes the rules of a firewall without the risk of losing the server:
// the change is applied with a timer that undoes it, then the panel opens a NEW connection to the server.
// only when that works the change is kept. A change that locks the panel out is undone by the server itself
export default class FirewallChangeRunner {
  constructor(
    private readonly getServerConnection: GetServerConnectionUseCase = new GetServerConnectionUseCase(),
    private readonly commandRunner: SshCommandRunner = sshCommandRunner,
    private readonly manager: Pick<SshConnectionManager, 'close'> = sshConnectionManager,
    private readonly logger: Logger = new Logger('Firewall'),
    private readonly rollbackSeconds: number = FIREWALL_ROLLBACK_SECONDS,
  ) {}

  public async run({ serverId, backend, change, sudoPassword }: RunFirewallChangeRequest): Promise<void> {
    if (serversBeingChanged.has(serverId)) {
      throw new ConflictError('FIREWALL_CHANGE_IN_PROGRESS', 'Another change of this firewall is still running')
    }

    serversBeingChanged.add(serverId)

    try {
      const buildScript = backend === 'ufw' ? changeUfwRulesScript : changeFirewalldRulesScript
      const input = { ...change, timeoutSeconds: this.rollbackSeconds }

      // --> apply the change, the server starts the timer that undoes it
      const connection = await this.getServerConnection.execute({ serverId })
      const applied = await this.commandRunner.runScript(connection, {
        ...buildScript({ ...input, phase: 'apply' }),
        sudoPassword,
      })

      this.assertSucceeded(serverId, 'apply', applied)

      // --> open a new connection: the open one keeps working even when the new rules refuse the panel
      this.manager.close(serverId)

      const newConnection = await this.getServerConnection.execute({ serverId }).catch((error: unknown) => {
        this.logger.warn('The server stopped answering after a firewall change', { serverId })

        throw new FirewallError(
          'FIREWALL_CHANGE_ROLLED_BACK',
          `The server stopped answering after the change, it undoes it by itself within ${this.rollbackSeconds} seconds`,
          { cause: error },
        )
      })

      // --> keep the change: stop the timer
      const committed = await this.commandRunner.runScript(newConnection, {
        ...buildScript({ ...input, phase: 'commit' }),
        sudoPassword,
      })

      this.assertSucceeded(serverId, 'commit', committed)
    } finally {
      serversBeingChanged.delete(serverId)
    }
  }

  // --> Reads the result, the last line that starts with the marker: "OK", or "ERROR:<reason>"
  private assertSucceeded(serverId: string, phase: string, { stdout, stderr }: CommandResult): void {
    const result = stdout
      .split('\n')
      .map((line) => line.trim())
      .findLast((line) => line.startsWith(FIREWALL_MARKER))
      ?.slice(FIREWALL_MARKER.length)

    if (result === 'OK') {
      return
    }

    const reason = result?.split(':')[1] ?? 'UNKNOWN'

    // --> the output of the firewall tool helps to find the cause
    this.logger.warn('Changing the firewall failed', { serverId, phase, reason, stderr: stderr.slice(0, 500) })

    switch (reason) {
      case 'BUSY':
        throw new ConflictError('FIREWALL_CHANGE_IN_PROGRESS', 'Another change of this firewall is still running')
      case 'RULE_NOT_FOUND':
        throw new FirewallError(
          'FIREWALL_RULE_NOT_CHANGEABLE',
          'The firewall does not hold this rule in a form the panel can delete, remove it on the server',
        )
      case 'ROLLED_BACK':
        throw new FirewallError(
          'FIREWALL_CHANGE_ROLLED_BACK',
          'The change was not confirmed in time, the server has undone it',
        )
      case 'SAVE_FAILED':
        throw new SshConnectionError(
          'SSH_COMMAND_FAILED',
          'The change is active but could not be saved, it will be lost when the firewall restarts',
        )
      default:
        throw new SshConnectionError('SSH_COMMAND_FAILED', 'The server could not change its firewall')
    }
  }
}
