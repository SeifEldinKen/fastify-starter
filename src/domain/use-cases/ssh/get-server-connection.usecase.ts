import type { PrismaClient } from '../../../generated/prisma/client.js'
import { prismaDb } from '../../../infrastructure/database/prisma.js'
import AesGcmService from '../../../infrastructure/security/encryption/aes-gcm.service.js'
import type { Encryptor } from '../../../infrastructure/security/encryption/encryption.types.js'
import type SshConnectionManager from '../../../infrastructure/ssh/ssh-connection.manager.js'
import { sshConnectionManager } from '../../../infrastructure/ssh/ssh-connection.manager.js'
import type { SshConnection } from '../../../infrastructure/ssh/ssh-connection.types.js'
import SshHostGuard from '../../../infrastructure/ssh/ssh-host.guard.js'
import NotFoundError from '../../../shared/errors/not-found.error.js'

interface GetServerConnectionRequest {
  serverId: string
}

// --> Returns the open connection of a server, opens it first when there is none
// Permissions are not checked here: EnsurePermissionHook already did it on the route
export default class GetServerConnectionUseCase {
  constructor(
    private readonly db: PrismaClient = prismaDb,
    private readonly manager: SshConnectionManager = sshConnectionManager,
    private readonly encryptor: Encryptor = new AesGcmService(),
    private readonly hostGuard: SshHostGuard = new SshHostGuard(),
  ) {}

  public async execute({ serverId }: GetServerConnectionRequest): Promise<SshConnection> {
    // --> return the open connection, no database query needed
    const existing = await this.manager.get(serverId)

    if (existing) {
      return existing
    }

    // --> find server with its shared credential (userId null = the one used by every member)
    const server = await this.db.server.findUnique({
      where: { id: serverId },
      select: {
        organizationId: true,
        host: true,
        port: true,
        hostFingerprint: true,
        credentials: {
          where: { userId: null },
          select: { username: true, privateKeyEncrypted: true },
          take: 1,
        },
      },
    })

    const credential = server?.credentials[0]

    // --> check if server exists and has a credential
    if (!server || !credential) {
      throw new NotFoundError('Server not found')
    }

    // --> decrypt the private key, it stays in memory only
    const privateKey = this.encryptor.decrypt({ value: credential.privateKeyEncrypted })

    // --> check again that the address is allowed: a host name can point somewhere else since the server was added
    const address = await this.hostGuard.resolve(server.host)

    // --> open the connection and keep it in the manager
    const connection = await this.manager.connect({
      serverId,
      organizationId: server.organizationId,
      host: address,
      port: server.port,
      username: credential.username,
      privateKey,
      ...(server.hostFingerprint ? { hostFingerprint: server.hostFingerprint } : {}),
    })

    // --> first connection: save the identity of the server, later connections are refused if it changes
    if (!server.hostFingerprint) {
      await this.db.server.updateMany({
        where: { id: serverId, hostFingerprint: null },
        data: {
          hostFingerprint: connection.hostFingerprint,
        },
      })
    }

    return connection
  }
}
