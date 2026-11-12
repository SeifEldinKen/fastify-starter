import { randomBytes } from 'node:crypto'
import ssh2 from 'ssh2'
import GetServerConnectionUseCase from '@/domain/use-cases/ssh/get-server-connection.usecase.js'
import type { PrismaClient } from '@/generated/prisma/client.js'
import { prismaDb } from '@/infrastructure/database/prisma.js'
import { createSystemUserScript, SCRIPT_RESULT_MARKER } from '@/infrastructure/ssh/scripts/create-system-user.script.js'
import type SshCommandRunner from '@/infrastructure/ssh/ssh-command.runner.js'
import { sshCommandRunner } from '@/infrastructure/ssh/ssh-command.runner.js'
import ConflictError from '@/shared/errors/conflict.error.js'
import SshConnectionError from '@/shared/errors/ssh-connection.error.js'
import ValidationError from '@/shared/errors/validation.error.js'
import Logger from '@/shared/logger.js'
import GetSystemUserUseCase from './get-system-user.usecase.js'
import { NEW_SYSTEM_GROUP_PATTERN, NEW_SYSTEM_USERNAME_PATTERN } from './system-user.rules.js'

const DESCRIPTION_PATTERN = /^[^:,\p{Cc}]{0,100}$/u
const SHELL_PATTERN = /^\/[a-zA-Z0-9/_.-]{1,99}$/
const PUBLIC_KEY_PATTERN =
  /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521)|sk-[a-z0-9-]+@openssh\.com) ([A-Za-z0-9+/]+={0,2})(?: ([\x20-\x7E]{0,200}))?$/

interface CreateSystemUserRequest {
  // --> From request.user and the route, both already checked by the hooks
  userId: string
  organizationId: string
  serverId: string
  username: string
  description: string
  shell: string
  createHome: boolean
  groups: string[]
  sudo: boolean
  // --> Never saved by the app and never written to the audit log
  password?: string | undefined
  generatePassword: boolean
  mustChangePassword: boolean
  sshKeys: string[]
  // --> Sudo password of the account on the server, only for an account whose sudo asks for one. Never saved
  sudoPassword?: string | undefined
}

type CreateSystemUserResponse = Awaited<ReturnType<GetSystemUserUseCase['execute']>> & {
  // --> Only when the app generated it, returned this one time and kept nowhere
  generatedPassword?: string
}

// --> Creates a Linux user on a server, needs root rights there
export default class CreateSystemUserUseCase {
  constructor(
    private readonly db: PrismaClient = prismaDb,
    private readonly getServerConnection: GetServerConnectionUseCase = new GetServerConnectionUseCase(),
    private readonly commandRunner: SshCommandRunner = sshCommandRunner,
    private readonly getSystemUser: GetSystemUserUseCase = new GetSystemUserUseCase(),
    private readonly logger: Logger = new Logger('SystemUsers'),
  ) {}

  public async execute(request: CreateSystemUserRequest): Promise<CreateSystemUserResponse> {
    const { userId, organizationId, serverId, username, description, shell, createHome, groups, sudo } = request
    const { generatePassword, mustChangePassword, sudoPassword } = request

    // --> every value is checked here too, whatever the caller already did: they all reach a root shell
    if (!NEW_SYSTEM_USERNAME_PATTERN.test(username)) {
      throw new ValidationError('Not a valid Linux user name')
    }

    if (!DESCRIPTION_PATTERN.test(description)) {
      throw new ValidationError('The description cannot contain ":" or "," or line breaks')
    }

    if (!SHELL_PATTERN.test(shell)) {
      throw new ValidationError('Not a valid shell path')
    }

    if (groups.some((group) => !NEW_SYSTEM_GROUP_PATTERN.test(group))) {
      throw new ValidationError('Not a valid Linux group name')
    }

    if (request.password !== undefined && generatePassword) {
      throw new ValidationError('Send a password or ask for a generated one, not both')
    }

    // --> the password travels as one line of the input
    if (request.password !== undefined && /\p{Cc}/u.test(request.password)) {
      throw new ValidationError('The password cannot contain line breaks or control characters')
    }

    // --> generate a password: 24 random characters, shown once in the response
    const password = generatePassword ? randomBytes(18).toString('base64url') : (request.password ?? '')

    if (mustChangePassword && password === '') {
      throw new ValidationError('A password is needed to force changing it')
    }

    if (request.sshKeys.length > 0 && !createHome) {
      throw new ValidationError('SSH keys are saved in the home folder, it must be created')
    }

    // --> check the public keys, and rebuild each line as "type key comment": options before the key are refused
    const sshKeys = request.sshKeys.map((line) => {
      const match = PUBLIC_KEY_PATTERN.exec(line.trim())
      const parsedKey = match ? ssh2.utils.parseKey(line.trim()) : new Error('Not a public key')

      if (!match || parsedKey instanceof Error) {
        throw new ValidationError('An SSH key is not a valid public key')
      }

      return [match[1], match[2], match[3]?.trim()].filter(Boolean).join(' ')
    })

    // --> get the connection of the server and run the script, the values go to its input
    const connection = await this.getServerConnection.execute({ serverId })

    const { script, stdin } = createSystemUserScript({
      username,
      description,
      shell,
      createHome,
      groups,
      sudo,
      mustChangePassword,
      password,
      sshKeys,
    })

    const { stdout, stderr } = await this.commandRunner.runScript(connection, { script, stdin, sudoPassword })

    // --> read the result, the last line that starts with the marker
    const result = stdout
      .split('\n')
      .map((line) => line.trim())
      .findLast((line) => line.startsWith(SCRIPT_RESULT_MARKER))
      ?.slice(SCRIPT_RESULT_MARKER.length)

    if (result !== 'OK') {
      const [, reason = 'UNKNOWN', detail = ''] = (result ?? '').split(':')

      // --> the output of the server tools helps to find the cause, it never holds the password
      this.logger.warn('Creating a system user failed', { serverId, username, reason, stderr: stderr.slice(0, 500) })

      throw this.toError(reason, detail)
    }

    // --> save who created it, without any secret
    await this.db.auditLog.create({
      data: {
        organizationId,
        userId,
        serverId,
        action: 'system_user.create',
        metadata: {
          username,
          shell,
          groups,
          sudo,
          hasPassword: password !== '',
          sshKeysCount: sshKeys.length,
        },
      },
    })

    // --> read the user back from the server: the response shows what really exists there
    const user = await this.getSystemUser.execute({ serverId, username, sudoPassword })

    return {
      ...user,
      ...(generatePassword && { generatedPassword: password }),
    }
  }

  // --> Turns the reason printed by the script into the error the client sees
  private toError(reason: string, detail: string): Error {
    switch (reason) {
      case 'USER_EXISTS':
        return new ConflictError('SYSTEM_USER_ALREADY_EXISTS', 'A user with this name already exists on the server')
      case 'GROUP_EXISTS':
        return new ConflictError('SYSTEM_USER_ALREADY_EXISTS', 'A group with this name already exists on the server')
      case 'INVALID_SHELL':
        return new ValidationError('This shell is not available on the server')
      case 'GROUP_NOT_FOUND':
        return new ValidationError(`The group "${detail}" does not exist on the server`)
      case 'PASSWORD_REJECTED':
        return new ValidationError('The server rejected the password, it may be too weak for its rules')
      case 'MUST_CHANGE_UNSUPPORTED':
        return new ValidationError('This server cannot force a password change')
      case 'NO_SUDO_GROUP':
        return new SshConnectionError('SSH_COMMAND_FAILED', 'This server has no "sudo" or "wheel" group')
      default:
        return new SshConnectionError('SSH_COMMAND_FAILED', 'The server could not create the user')
    }
  }
}
