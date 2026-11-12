import { randomUUID } from 'node:crypto'
import ssh2 from 'ssh2'
import type { PrismaClient } from '@/generated/prisma/client.js'
import { prismaDb } from '@/infrastructure/database/prisma.js'
import AesGcmService from '@/infrastructure/security/encryption/aes-gcm.service.js'
import type { Encryptor } from '@/infrastructure/security/encryption/encryption.types.js'
import type SshConnectionManager from '@/infrastructure/ssh/ssh-connection.manager.js'
import { sshConnectionManager } from '@/infrastructure/ssh/ssh-connection.manager.js'
import SshHostGuard from '@/infrastructure/ssh/ssh-host.guard.js'
import SshKeyInstaller from '@/infrastructure/ssh/ssh-key.installer.js'
import ConflictError from '@/shared/errors/conflict.error.js'
import ValidationError from '@/shared/errors/validation.error.js'

interface CreateServerRequest {
  // --> From request.user and the route, both already checked by the hooks
  userId: string
  organizationId: string
  name: string
  host: string
  port: number
  username: string
  // --> One of the two: a private key, or the password of the account
  privateKey?: string | undefined
  // --> Used once to add a new key of the panel to the account, then forgotten: never saved, never logged
  password?: string | undefined
}

interface CreateServerResponse {
  id: string
  name: string
  host: string
  port: number
  username: string
  hostFingerprint: string
}

// --> Adds a server to an organization, only after a real connection to it succeeded
export default class CreateServerUseCase {
  constructor(
    private readonly db: PrismaClient = prismaDb,
    private readonly manager: SshConnectionManager = sshConnectionManager,
    private readonly encryptor: Encryptor = new AesGcmService(),
    private readonly hostGuard: SshHostGuard = new SshHostGuard(),
    private readonly keyInstaller: SshKeyInstaller = new SshKeyInstaller(),
  ) {}

  public async execute(request: CreateServerRequest): Promise<CreateServerResponse> {
    const { userId, organizationId, name, port, username, password } = request

    // --> one way to sign in, not both
    if ((request.privateKey === undefined) === (password === undefined)) {
      throw new ValidationError('Send either a private key or a password')
    }

    // --> same host whatever the letter case or the spaces around it
    const host = request.host.trim().toLowerCase()

    // --> find server in the organization
    const existing = await this.db.server.findFirst({
      where: { organizationId, host, port },
      select: {
        id: true,
      },
    })

    // --> check if the organization already has this server
    if (existing) {
      throw new ConflictError('SERVER_ALREADY_EXISTS', 'This server is already added to the organization')
    }

    // --> check the private key before using it: wrong format, or protected by a passphrase
    const parsedKey = request.privateKey !== undefined ? ssh2.utils.parseKey(request.privateKey) : undefined

    if (parsedKey instanceof Error) {
      throw new ValidationError(
        parsedKey.message.includes('passphrase')
          ? 'Private keys protected by a passphrase are not supported'
          : 'The private key is not valid',
      )
    }

    // --> check the address is allowed, and get the IP address to connect to
    const address = await this.hostGuard.resolve(host)

    let privateKey = request.privateKey ?? ''
    let hostFingerprint: string | undefined

    // --> with a password: sign in once, add a new key of the panel to the account, and forget the password
    if (password !== undefined) {
      const installed = await this.keyInstaller.install({
        host: address,
        port,
        username,
        password,
      })

      privateKey = installed.privateKey
      // --> the connection with the key must reach the same server
      hostFingerprint = installed.hostFingerprint
    }

    // --> generate server id
    const serverId = randomUUID()

    // --> open connection to the server
    const connection = await this.manager.connect({
      serverId,
      organizationId,
      host: address,
      port,
      username,
      privateKey,
      hostFingerprint,
    })

    // --> encrypt the private key
    const encryptedPrivateKey = this.encryptor.encrypt({
      value: privateKey,
    })

    try {
      // --> everything or nothing: the server, its credential and the audit log
      return await this.db.$transaction(async (db) => {
        // --> create server with the identity it showed on this first connection
        const server = await db.server.create({
          data: {
            id: serverId,
            organizationId,
            name,
            host,
            port,
            hostFingerprint: connection.hostFingerprint,
            credentials: {
              // --> only the encrypted key is saved, shared by every member (no userId)
              create: {
                username,
                privateKeyEncrypted: encryptedPrivateKey,
              },
            },
          },
          select: {
            id: true,
            name: true,
            host: true,
            port: true,
          },
        })

        // --> save who added it
        await db.auditLog.create({
          data: {
            organizationId,
            userId,
            serverId,
            action: 'server.create',
            metadata: {
              name,
              host,
              port,
              username,
              // --> a key of the panel was added to the account on the server
              isKeyInstalled: password !== undefined,
            },
          },
        })

        return {
          ...server,
          username,
          hostFingerprint: connection.hostFingerprint,
        }
      })
    } catch (error) {
      // --> not saved: do not keep a connection to a server that does not exist
      this.manager.close(serverId)

      throw error
    }
  }
}
