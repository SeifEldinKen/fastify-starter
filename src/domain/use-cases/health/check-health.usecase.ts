import type { Redis } from 'ioredis'
import type { PrismaClient } from '@/generated/prisma/client.js'
import { prismaDb } from '@/infrastructure/database/prisma.js'
import { getRedisClient } from '@/infrastructure/redis/redis.js'

const CHECK_TIMEOUT_MS = 2_000

interface ServiceHealth {
  status: 'up' | 'down'
  // --> How long the service took to answer, missing when it is down
  latencyMs?: number
}

interface CheckHealthResponse {
  // --> 'ok' only when every service is up
  status: 'ok' | 'degraded'
  // --> Tells which instance answered when several are running
  pid: number
  // --> Seconds since the process started
  uptimeSeconds: number
  timestamp: string
  services: {
    database: ServiceHealth
    redis: ServiceHealth
  }
}

// --> Really asks the database and Redis, so a load balancer stops sending requests to an instance that cannot serve them
export default class CheckHealthUseCase {
  constructor(
    private readonly db: PrismaClient = prismaDb,
    private readonly getRedis: () => Redis = getRedisClient,
  ) {}

  public async execute(): Promise<CheckHealthResponse> {
    // --> check both services at the same time
    const [database, redis] = await Promise.all([
      this.check(() => this.db.$queryRaw`SELECT 1`),
      this.check(() => this.getRedis().ping()),
    ])

    return {
      status: database.status === 'up' && redis.status === 'up' ? 'ok' : 'degraded',
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      services: {
        database,
        redis,
      },
    }
  }

  // --> Never throws: a failing or slow service is reported as 'down'
  private async check(ping: () => Promise<unknown>): Promise<ServiceHealth> {
    const startedAt = performance.now()
    let timer: NodeJS.Timeout | undefined

    try {
      await Promise.race([
        ping(),
        new Promise((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Health check timed out')), CHECK_TIMEOUT_MS)
        }),
      ])

      return {
        status: 'up',
        latencyMs: Math.round(performance.now() - startedAt),
      }
    } catch {
      return { status: 'down' }
    } finally {
      clearTimeout(timer)
    }
  }
}
