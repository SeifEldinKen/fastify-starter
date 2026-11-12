import GetServerConnectionUseCase from '@/domain/use-cases/ssh/get-server-connection.usecase.js'
import type SshCommandRunner from '@/infrastructure/ssh/ssh-command.runner.js'
import { sshCommandRunner } from '@/infrastructure/ssh/ssh-command.runner.js'
import SshConnectionError from '@/shared/errors/ssh-connection.error.js'

const TEST_TIMEOUT_MS = 10_000

interface TestServerConnectionRequest {
  // --> EnsurePermissionHook already checked it belongs to the organization and the member can access it
  serverId: string
}

interface TestServerConnectionResponse {
  isConnected: true
  // --> Time to connect (when no connection was open) and to run one command
  latencyMs: number
}

// --> Checks that the server still answers: connects when needed, then runs a command that does nothing
export default class TestServerConnectionUseCase {
  constructor(
    private readonly getServerConnection: GetServerConnectionUseCase = new GetServerConnectionUseCase(),
    private readonly commandRunner: SshCommandRunner = sshCommandRunner,
  ) {}

  public async execute({ serverId }: TestServerConnectionRequest): Promise<TestServerConnectionResponse> {
    const startedAt = performance.now()

    // --> get the open connection, or open one (throws SshConnectionError)
    const connection = await this.getServerConnection.execute({ serverId })

    // --> an open connection can still be dead: run a real command through it
    const { code } = await this.commandRunner.run(connection, { command: 'true', timeoutMs: TEST_TIMEOUT_MS })

    if (code !== 0) {
      throw new SshConnectionError('SSH_UNREACHABLE', 'The server did not run the test command')
    }

    return {
      isConnected: true,
      latencyMs: Math.round(performance.now() - startedAt),
    }
  }
}
