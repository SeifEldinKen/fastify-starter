import type { Redis } from 'ioredis'
import { getRedisClient } from './redis.js'

// --> How long the readings of a server are kept: the key is gone one hour after the last reading
export const SERVER_METRICS_RETENTION_SECONDS = 60 * 60

// --> One reading every 15 seconds: 240 readings in one hour
const MAX_SAMPLES = 240

// --> List of readings per server, the oldest first, as JSON
const keyOf = (serverId: string): string => `server-metrics:${serverId}`

export interface ServerMetricsSample {
  // --> ISO date of the reading
  at: string
  cores: number
  // --> null for the first reading after a connection: the use of the CPU is known from two readings only
  cpuPercent: number | null
  memoryUsedBytes: number
  memoryTotalBytes: number
  swapUsedBytes: number
  swapTotalBytes: number
  // --> Average number of waiting tasks over 1, 5 and 15 minutes
  load: [number, number, number]
  uptimeSeconds: number
}

export interface StoredServerMetrics {
  latest: ServerMetricsSample
  // --> The oldest first, empty when it was not asked for
  history: ServerMetricsSample[]
}

// --> Readings of the load of the servers, shared by every instance of the app
export default class ServerMetricsStore {
  constructor(private readonly redis: Redis = getRedisClient()) {}

  public async add(serverId: string, sample: ServerMetricsSample): Promise<void> {
    const key = keyOf(serverId)

    // --> add, keep the last readings only, and push the end of life of the key
    await this.redis
      .multi()
      .rpush(key, JSON.stringify(sample))
      .ltrim(key, -MAX_SAMPLES, -1)
      .expire(key, SERVER_METRICS_RETENTION_SECONDS)
      .exec()
  }

  // --> Readings of many servers in one round trip. A server without a reading in the last hour is not in the map
  public async read(
    serverIds: string[],
    { historySeconds = 0 }: { historySeconds?: number } = {},
  ): Promise<Map<string, StoredServerMetrics>> {
    const result = new Map<string, StoredServerMetrics>()

    if (serverIds.length === 0) {
      return result
    }

    // --> without history only the last reading is read
    const pipeline = this.redis.pipeline()

    for (const serverId of serverIds) {
      if (historySeconds > 0) {
        pipeline.lrange(keyOf(serverId), 0, -1)
      } else {
        pipeline.lrange(keyOf(serverId), -1, -1)
      }
    }

    const replies = (await pipeline.exec()) ?? []
    const now = Date.now()

    serverIds.forEach((serverId, index) => {
      const [error, lines] = replies[index] ?? []

      if (error || !Array.isArray(lines)) {
        return
      }

      // --> the list keeps readings from before a pause: only the ones of the last hour count
      const samples = lines
        .map((line) => this.parse(String(line)))
        .filter((sample): sample is ServerMetricsSample => {
          return sample !== null && now - Date.parse(sample.at) <= SERVER_METRICS_RETENTION_SECONDS * 1000
        })

      const latest = samples.at(-1)

      if (!latest) {
        return
      }

      result.set(serverId, {
        latest,
        history:
          historySeconds > 0 ? samples.filter((sample) => now - Date.parse(sample.at) <= historySeconds * 1000) : [],
      })
    })

    return result
  }

  private parse(line: string): ServerMetricsSample | null {
    try {
      return JSON.parse(line) as ServerMetricsSample
    } catch {
      return null
    }
  }
}
