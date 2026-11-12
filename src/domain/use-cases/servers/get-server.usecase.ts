import {
  SERVER_METRICS_HISTORY_RANGES,
  type ServerMetricsDetails,
  type ServerMetricsHistoryRange,
  toServerMetricsDetails,
} from '@/domain/use-cases/server-metrics/server-metrics.rules.js'
import type { PrismaClient } from '@/generated/prisma/client.js'
import { prismaDb } from '@/infrastructure/database/prisma.js'
import ServerMetricsStore from '@/infrastructure/redis/server-metrics.store.js'
import type SshConnectionManager from '@/infrastructure/ssh/ssh-connection.manager.js'
import { sshConnectionManager } from '@/infrastructure/ssh/ssh-connection.manager.js'
import NotFoundError from '@/shared/errors/not-found.error.js'

interface GetServerRequest {
  // --> EnsurePermissionHook already checked it belongs to the organization and the member can access it
  serverId: string
  // --> Add the readings of this range to draw a line, undefined for the last reading only
  history?: ServerMetricsHistoryRange | undefined
}

interface GetServerResponse {
  id: string
  name: string
  host: string
  port: number
  username: string
  hostFingerprint: string | null
  isConnected: boolean
  // --> The load of the server, read in the background while it is connected. null without a reading in the last hour
  metrics: ServerMetricsDetails | null
}

// --> Details of one server, the private key is never part of it
export default class GetServerUseCase {
  constructor(
    private readonly db: PrismaClient = prismaDb,
    private readonly manager: SshConnectionManager = sshConnectionManager,
    private readonly metricsStore: ServerMetricsStore = new ServerMetricsStore(),
  ) {}

  public async execute({ serverId, history }: GetServerRequest): Promise<GetServerResponse> {
    // --> find server with the user name of its shared credential
    const server = await this.db.server.findUnique({
      where: { id: serverId },
      select: {
        id: true,
        name: true,
        host: true,
        port: true,
        hostFingerprint: true,
        credentials: {
          where: { userId: null },
          select: { username: true },
          take: 1,
        },
      },
    })

    const credential = server?.credentials[0]

    if (!server || !credential) {
      throw new NotFoundError('Server not found')
    }

    // --> get the readings saved by the collector: the server is not reached during the request
    const metrics = await this.metricsStore.read([server.id], {
      historySeconds: history ? SERVER_METRICS_HISTORY_RANGES[history] : 0,
    })
    const stored = metrics.get(server.id)

    return {
      id: server.id,
      name: server.name,
      host: server.host,
      port: server.port,
      username: credential.username,
      hostFingerprint: server.hostFingerprint,
      isConnected: this.manager.has(server.id),
      metrics: stored ? toServerMetricsDetails(stored) : null,
    }
  }
}
