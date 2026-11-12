import type { PrismaClient } from '@/generated/prisma/client.js'
import { prismaDb } from '@/infrastructure/database/prisma.js'
import type SshConnectionManager from '@/infrastructure/ssh/ssh-connection.manager.js'
import { sshConnectionManager } from '@/infrastructure/ssh/ssh-connection.manager.js'

interface ListConnectedServersRequest {
  organizationId: string
  // --> From request.access, set by EnsurePermissionHook
  membershipId: string
  // --> true when the member holds "server:access-all"
  canAccessAll: boolean
}

interface ConnectedServer {
  id: string
  name: string
  host: string
  port: number
}

// --> Servers of the organization with an open SSH connection right now, that the member is allowed to see
export default class ListConnectedServersUseCase {
  constructor(
    private readonly db: PrismaClient = prismaDb,
    private readonly manager: SshConnectionManager = sshConnectionManager,
  ) {}

  public async execute(request: ListConnectedServersRequest): Promise<ConnectedServer[]> {
    const { organizationId, membershipId, canAccessAll } = request

    // --> get the servers of the organization with an open connection
    const connectedServerIds = this.manager.getConnectedServerIds(organizationId)

    // --> nothing is connected, no need to ask the database
    if (connectedServerIds.length === 0) {
      return []
    }

    // --> find servers
    const servers = await this.db.server.findMany({
      where: {
        id: { in: connectedServerIds },
        organizationId,
        ...(canAccessAll ? {} : { access: { some: { membershipId } } }),
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        host: true,
        port: true,
      },
    })

    // --> format connected servers
    const connectedServersFormatted = servers.map((server) => ({
      id: server.id,
      name: server.name,
      host: server.host,
      port: server.port,
    }))

    return connectedServersFormatted
  }
}
