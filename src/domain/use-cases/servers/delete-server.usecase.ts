import type { PrismaClient } from '@/generated/prisma/client.js'
import { prismaDb } from '@/infrastructure/database/prisma.js'
import type SshConnectionManager from '@/infrastructure/ssh/ssh-connection.manager.js'
import { sshConnectionManager } from '@/infrastructure/ssh/ssh-connection.manager.js'
import NotFoundError from '@/shared/errors/not-found.error.js'

interface DeleteServerRequest {
  userId: string
  // --> EnsurePermissionHook already checked it belongs to the organization and the member can access it
  serverId: string
}

// --> Deletes a server with its key and access grants, and closes its connection
export default class DeleteServerUseCase {
  constructor(
    private readonly db: PrismaClient = prismaDb,
    private readonly manager: SshConnectionManager = sshConnectionManager,
  ) {}

  public async execute({ userId, serverId }: DeleteServerRequest): Promise<void> {
    // --> find server
    const server = await this.db.server.findUnique({
      where: { id: serverId },
      select: { organizationId: true, name: true, host: true, port: true },
    })

    if (!server) {
      throw new NotFoundError('Server not found')
    }

    await this.db.$transaction(async (db) => {
      // --> delete server, its credential and access grants are deleted with it
      await db.server.delete({
        where: { id: serverId },
      })

      // --> save who deleted it, the details are copied because the server row is gone
      await db.auditLog.create({
        data: {
          organizationId: server.organizationId,
          userId,
          action: 'server.delete',
          metadata: { serverId, name: server.name, host: server.host, port: server.port },
        },
      })
    })

    // --> close the open connection, in this instance of the app
    this.manager.close(serverId)
  }
}
