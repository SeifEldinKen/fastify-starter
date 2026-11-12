import ssh2 from 'ssh2'
import SshConnectionError from '../../shared/errors/ssh-connection.error.js'
import { INSTALL_KEY_RESULT_MARKER, installAuthorizedKeyScript } from './scripts/install-authorized-key.script.js'
import type SshCommandRunner from './ssh-command.runner.js'
import { sshCommandRunner } from './ssh-command.runner.js'
import SshConnectionOpener from './ssh-connection.opener.js'

// --> Written next to the key on the server, so its owner knows where it comes from
const KEY_COMMENT = 'server-panel'

interface InstallKeyRequest {
  host: string
  port: number
  username: string
  // --> Used for this one connection only: never saved, never logged
  password: string
}

interface InstallKeyResponse {
  // --> The new private key, to save encrypted like a key sent by the user
  privateKey: string
  // --> The identity the server showed, the next connection must see the same one
  hostFingerprint: string
}

// --> Signs in once with a password, adds a new key of the panel to the account, and forgets the password
// like ssh-copy-id: every connection after it uses the key
export default class SshKeyInstaller {
  constructor(
    private readonly opener: SshConnectionOpener = new SshConnectionOpener(),
    private readonly commandRunner: SshCommandRunner = sshCommandRunner,
  ) {}

  public async install({ host, port, username, password }: InstallKeyRequest): Promise<InstallKeyResponse> {
    // --> a connection of its own, never kept by the manager
    const connection = await this.opener.open({ host, port, username, password })

    try {
      // --> one new key per server
      const { private: privateKey, public: publicKey } = ssh2.utils.generateKeyPairSync('ed25519', {
        comment: KEY_COMMENT,
      })

      const { stdout } = await this.commandRunner.runScript(connection, installAuthorizedKeyScript(publicKey))

      const result = stdout
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line.startsWith(INSTALL_KEY_RESULT_MARKER))
        ?.slice(INSTALL_KEY_RESULT_MARKER.length)

      if (result !== 'OK') {
        throw new SshConnectionError(
          'SSH_KEY_NOT_INSTALLED',
          result === 'ERROR:NO_HOME'
            ? 'The account has no home folder to keep the key in'
            : 'The key could not be added to the account, check the rights of its ~/.ssh folder',
        )
      }

      return {
        privateKey,
        hostFingerprint: connection.hostFingerprint,
      }
    } finally {
      connection.client.end()
    }
  }
}
