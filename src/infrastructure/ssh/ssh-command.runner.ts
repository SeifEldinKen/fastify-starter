import SshConnectionError from '../../shared/errors/ssh-connection.error.js'
import SudoError from '../../shared/errors/sudo.error.js'
import ValidationError from '../../shared/errors/validation.error.js'
import {
  SUDO_NOT_ALLOWED_MARKER,
  SUDO_PASSWORD_MARKER,
  SUDO_REQUIRED_MARKER,
  VERIFY_SUDO_PASSWORD_SCRIPT,
} from './scripts/sudo.script.js'
import type { SshConnection } from './ssh-connection.types.js'

const COMMAND_TIMEOUT_MS = 30_000

export interface CommandResult {
  stdout: string
  stderr: string
  // --> Exit code of the command: 0 means success, null when it was killed by a signal
  code: number | null
}

interface RunOptions {
  timeoutMs?: number
  // --> Sent to the command as its input: secrets go here and never in the command text,
  // where every user of the server could read them in the process list
  stdin?: string
}

interface RunRequest extends RunOptions {
  // --> Never pass text typed by a user: the use case builds the command from validated values
  command: string
}

interface RunScriptRequest extends RunOptions {
  // --> Fixed text: the values of a request go to its input (stdin), never into the script
  script: string
  // --> Password of the account on the server, for an account whose sudo asks for one
  // it comes with the request and only lives until the script ends: never saved, never logged
  sudoPassword?: string | undefined
}

// --> Runs one command on an open connection, each run opens its own channel and closes it at the end
export default class SshCommandRunner {
  public run(connection: SshConnection, request: RunRequest): Promise<CommandResult> {
    const { command, timeoutMs = COMMAND_TIMEOUT_MS, stdin } = request

    return new Promise((resolve, reject) => {
      // --> run the command
      connection.client.exec(command, (error, stream) => {
        if (error) {
          reject(new SshConnectionError('SSH_UNREACHABLE', 'Could not run the command', { cause: error }))
          return
        }

        const stdout: Buffer[] = []
        const stderr: Buffer[] = []

        // --> a command that never ends would keep its channel forever, close it
        const timer = setTimeout(() => {
          stream.close()
          reject(new SshConnectionError('SSH_COMMAND_TIMEOUT', 'The command took too long'))
        }, timeoutMs)

        stream.on('data', (chunk: Buffer) => stdout.push(chunk))
        stream.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))

        // --> 'close' fires after the command exits and all output is received
        stream.on('close', (code: number | null) => {
          clearTimeout(timer)

          resolve({
            stdout: Buffer.concat(stdout).toString('utf8'),
            stderr: Buffer.concat(stderr).toString('utf8'),
            code: code ?? null,
          })
        })

        // --> send the input and close it, a command reading its input would wait forever otherwise
        stream.end(stdin)
      })
    })
  }

  // --> Runs a multi-line shell script with "sh", whatever the login shell of the account is
  // a script that needs root rights says so itself (see sudo.script.ts), here it becomes the error the client sees
  public async runScript(connection: SshConnection, request: RunScriptRequest): Promise<CommandResult> {
    const { script, sudoPassword, ...options } = request

    // --> the script is wrapped in single quotes, one inside it would end the quoting
    if (script.includes("'")) {
      throw new Error('A script cannot contain a single quote')
    }

    // --> a password was sent and the account needs it: the whole script runs as root, under one sudo
    if (sudoPassword !== undefined && (await this.needsSudoPassword(connection, sudoPassword))) {
      return this.run(connection, {
        ...options,
        // --> "-k" makes sudo ask for the password every time, so it always reads the first line of the input
        // sudo starts the script with a clean environment, SSH_CONNECTION is the one value scripts read from it
        command: `sudo -k -S -p "" env "SSH_CONNECTION=$SSH_CONNECTION" sh -c '${script}'`,
        // --> sudo reads one line, the password. The lines after it reach the script untouched
        stdin: `${sudoPassword}\n${options.stdin ?? ''}`,
      })
    }

    const result = await this.run(connection, { ...options, command: `sh -c '${script}'` })

    // --> the script stopped at its first line: it needs root rights the account does not have
    const firstLine = result.stdout.trimStart().split('\n')[0]?.trim()

    if (firstLine === SUDO_REQUIRED_MARKER) {
      throw new SudoError(
        'SUDO_PASSWORD_REQUIRED',
        'This needs root rights on the server, send the sudo password of its account in the "X-Sudo-Password" header',
      )
    }

    if (firstLine === SUDO_NOT_ALLOWED_MARKER) {
      throw new SudoError('SUDO_NOT_ALLOWED', 'The account used to connect to this server is not allowed to use sudo')
    }

    return result
  }

  // --> Checks the password on the server. false when the account does not need one (root, or sudo without password)
  private async needsSudoPassword(connection: SshConnection, sudoPassword: string): Promise<boolean> {
    // --> the password travels as one line of the input
    if (sudoPassword === '' || /\p{Cc}/u.test(sudoPassword)) {
      throw new ValidationError('The sudo password cannot be empty or contain line breaks or control characters')
    }

    const { stdout } = await this.run(connection, {
      command: `sh -c '${VERIFY_SUDO_PASSWORD_SCRIPT}'`,
      stdin: `${sudoPassword}\n`,
    })

    const result = stdout
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.startsWith(SUDO_PASSWORD_MARKER))
      ?.slice(SUDO_PASSWORD_MARKER.length)

    switch (result) {
      case 'NOT_NEEDED':
        return false
      case 'OK':
        return true
      case 'NOT_ALLOWED':
        throw new SudoError('SUDO_NOT_ALLOWED', 'The account used to connect to this server is not allowed to use sudo')
      case 'INCORRECT':
        throw new SudoError('SUDO_PASSWORD_INCORRECT', 'The sudo password is not correct')
      default:
        throw new SshConnectionError('SSH_COMMAND_FAILED', 'The server could not check the sudo password')
    }
  }
}

// --> Single runner for the whole app
export const sshCommandRunner = new SshCommandRunner()
