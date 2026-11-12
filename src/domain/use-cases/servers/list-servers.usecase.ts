import {
  SERVER_METRICS_HISTORY_RANGES,
  type ServerMetrics,
  type ServerMetricsHistoryRange,
  toServerMetrics,
} from '@/domain/use-cases/server-metrics/server-metrics.rules.js'
import type { PrismaClient } from '@/generated/prisma/client.js'
import { prismaDb } from '@/infrastructure/database/prisma.js'
import ServerMetricsStore from '@/infrastructure/redis/server-metrics.store.js'
import type SshConnectionManager from '@/infrastructure/ssh/ssh-connection.manager.js'
import { sshConnectionManager } from '@/infrastructure/ssh/ssh-connection.manager.js'

interface ListServersRequest {
  organizationId: string
  // --> From request.access, set by EnsurePermissionHook
  membershipId: string
  // --> true when the member holds "server:access-all"
  canAccessAll: boolean
  // --> Add the readings of this range to draw a line, undefined for the last reading only
  history?: ServerMetricsHistoryRange | undefined
}

interface ListedServer {
  id: string
  name: string
  host: string
  port: number
  // --> An SSH connection to it is open right now, in this instance of the app
  isConnected: boolean
  // --> The load of the server, read in the background while it is connected. null without a reading in the last hour
  metrics: ServerMetrics | null
}

// --> Servers of the organization the member is allowed to see
export default class ListServersUseCase {
  constructor(
    private readonly db: PrismaClient = prismaDb,
    private readonly manager: SshConnectionManager = sshConnectionManager,
    private readonly metricsStore: ServerMetricsStore = new ServerMetricsStore(),
  ) {}

  public async execute(request: ListServersRequest): Promise<ListedServer[]> {
    const { organizationId, membershipId, canAccessAll, history } = request

    // --> find servers, without "server:access-all" only the ones granted to the member
    const servers = await this.db.server.findMany({
      where: {
        organizationId,
        ...(canAccessAll ? {} : { access: { some: { membershipId } } }),
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, host: true, port: true },
    })

    // --> get the readings saved by the collector: no server is reached during the request
    const metrics = await this.metricsStore.read(
      servers.map((server) => server.id),
      { historySeconds: history ? SERVER_METRICS_HISTORY_RANGES[history] : 0 },
    )

    return servers.map((server) => {
      const stored = metrics.get(server.id)

      return {
        ...server,
        isConnected: this.manager.has(server.id),
        metrics: stored ? toServerMetrics(stored) : null,
      }
    })
  }
}
