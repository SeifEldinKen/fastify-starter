import type { PrismaClient } from '@/generated/prisma/client.js'
import { prismaDb } from '@/infrastructure/database/prisma.js'
import AesGcmService from '@/infrastructure/security/encryption/aes-gcm.service.js'
import type { Encryptor } from '@/infrastructure/security/encryption/encryption.types.js'
import type SshConnectionManager from '@/infrastructure/ssh/ssh-connection.manager.js'
import { sshConnectionManager } from '@/infrastructure/ssh/ssh-connection.manager.js'
import SshHostGuard from '@/infrastructure/ssh/ssh-host.guard.js'
import { assertUsablePrivateKey } from '@/infrastructure/ssh/ssh-private-key.js'
import ConflictError from '@/shared/errors/conflict.error.js'
import NotFoundError from '@/shared/errors/not-found.error.js'

interface UpdateServerRequest {
  userId: string
  // --> EnsurePermissionHook already checked it belongs to the organization and the member can access it
  serverId: string
  // --> Only the fields that are sent are changed
  name?: string | undefined
  host?: string | undefined
  port?: number | undefined
  username?: string | undefined
  privateKey?: string | undefined
}

interface UpdateServerResponse {
  id: string
  name: string
  host: string
  port: number
  username: string
  hostFingerprint: string | null
}

// --> Changes a server, connection settings are saved only after a real connection with them succeeded
export default class UpdateServerUseCase {
  constructor(
    private readonly db: PrismaClient = prismaDb,
    private readonly manager: SshConnectionManager = sshConnectionManager,
    private readonly encryptor: Encryptor = new AesGcmService(),
    private readonly hostGuard: SshHostGuard = new SshHostGuard(),
  ) {}

  public async execute(request: UpdateServerRequest): Promise<UpdateServerResponse> {
    const { userId, serverId } = request

    // --> find server with its shared credential
    const server = await this.db.server.findUnique({
      where: { id: serverId },
      select: {
        organizationId: true,
        name: true,
        host: true,
        port: true,
        hostFingerprint: true,
        credentials: {
          where: { userId: null },
          select: { id: true, username: true, privateKeyEncrypted: true },
          take: 1,
        },
      },
    })

    const credential = server?.credentials[0]

    if (!server || !credential) {
      throw new NotFoundError('Server not found')
    }

    // --> the new settings: what was sent, the saved value for the rest
    const name = request.name ?? server.name
    const host = request.host?.trim().toLowerCase() ?? server.host
    const port = request.port ?? server.port
    const username = request.username ?? credential.username

    const isAddressChanged = host !== server.host || port !== server.port
    const isConnectionChanged = isAddressChanged || username !== credential.username || request.privateKey !== undefined

    let hostFingerprint = server.hostFingerprint

    if (isConnectionChanged) {
      // --> check if the organization already has a server at the new address
      if (isAddressChanged) {
        const existing = await this.db.server.findFirst({
          where: { organizationId: server.organizationId, host, port, id: { not: serverId } },
          select: { id: true },
        })

        if (existing) {
          throw new ConflictError('SERVER_ALREADY_EXISTS', 'This server is already added to the organization')
        }
      }

      // --> the key to connect with: the new one, or the saved one
      if (request.privateKey !== undefined) {
        assertUsablePrivateKey(request.privateKey)
      }

      const privateKey = request.privateKey ?? this.encryptor.decrypt({ value: credential.privateKeyEncrypted })

      // --> check the address is allowed, and get the IP address to connect to
      const address = await this.hostGuard.resolve(host)

      // --> close the connection opened with the old settings
      this.manager.close(serverId)

      // --> open a real connection with the new settings, nothing is saved when it fails (throws SshConnectionError)
      // same address: the server must still show the saved identity, new address: it is another machine
      const connection = await this.manager
        .connect({
          serverId,
          organizationId: server.organizationId,
          host: address,
          port,
          username,
          privateKey,
          ...(!isAddressChanged && server.hostFingerprint ? { hostFingerprint: server.hostFingerprint } : {}),
        })
        .catch((error: unknown) => {
          // --> the manager remembers a rejected key for a while: forget it, the saved settings still work
          this.manager.close(serverId)

          throw error
        })

      hostFingerprint = connection.hostFingerprint
    }

    // --> names of the changed fields for the audit log, never their values (a key is one of them)
    const changedFields = [
      ...(name !== server.name ? ['name'] : []),
      ...(host !== server.host ? ['host'] : []),
      ...(port !== server.port ? ['port'] : []),
      ...(username !== credential.username ? ['username'] : []),
      ...(request.privateKey !== undefined ? ['privateKey'] : []),
    ]

    try {
      // --> everything or nothing: the server, its credential and the audit log
      await this.db.$transaction(async (db) => {
        await db.server.update({
          where: { id: serverId },
          data: { name, host, port, hostFingerprint },
        })

        await db.serverCredential.update({
          where: { id: credential.id },
          data: {
            username,
            ...(request.privateKey !== undefined && {
              privateKeyEncrypted: this.encryptor.encrypt({ value: request.privateKey }),
            }),
          },
        })

        await db.auditLog.create({
          data: {
            organizationId: server.organizationId,
            userId,
            serverId,
            action: 'server.update',
            metadata: { changedFields },
          },
        })
      })
    } catch (error) {
      // --> not saved: the open connection uses settings the database does not have
      if (isConnectionChanged) {
        this.manager.close(serverId)
      }

      throw error
    }

    return { id: serverId, name, host, port, username, hostFingerprint }
  }
}
