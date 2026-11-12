import type { StoredServerMetrics } from '@/infrastructure/redis/server-metrics.store.js'
import { SERVER_METRICS_INTERVAL_SECONDS } from './server-metrics.collector.js'

// --> How far back the drawn line can go, in seconds
export const SERVER_METRICS_HISTORY_RANGES = {
  '15m': 15 * 60,
  '1h': 60 * 60,
} as const

export type ServerMetricsHistoryRange = keyof typeof SERVER_METRICS_HISTORY_RANGES

export const SERVER_METRICS_HISTORY_RANGE_NAMES = Object.keys(
  SERVER_METRICS_HISTORY_RANGES,
) as ServerMetricsHistoryRange[]

// --> The short form, for the list of servers
export interface ServerMetrics {
  // --> When the last reading was taken: an old date means the connection is closed
  sampledAt: string
  intervalSeconds: number
  cpu: {
    // --> null for the first reading after a connection
    percent: number | null
    cores: number
  }
  memory: {
    usedBytes: number
    totalBytes: number
  }
  // --> The oldest first, empty when no history was asked for
  history: { at: string; cpuPercent: number | null; memoryUsedBytes: number }[]
}

// --> The long form, for the details of one server
export type ServerMetricsDetails = ServerMetrics & {
  swap: {
    usedBytes: number
    totalBytes: number
  }
  // --> Average number of waiting tasks over 1, 5 and 15 minutes
  load: { one: number; five: number; fifteen: number }
  uptimeSeconds: number
}

export const toServerMetrics = ({ latest, history }: StoredServerMetrics): ServerMetrics => {
  return {
    sampledAt: latest.at,
    intervalSeconds: SERVER_METRICS_INTERVAL_SECONDS,
    cpu: { percent: latest.cpuPercent, cores: latest.cores },
    memory: { usedBytes: latest.memoryUsedBytes, totalBytes: latest.memoryTotalBytes },
    history: history.map((sample) => ({
      at: sample.at,
      cpuPercent: sample.cpuPercent,
      memoryUsedBytes: sample.memoryUsedBytes,
    })),
  }
}

export const toServerMetricsDetails = (stored: StoredServerMetrics): ServerMetricsDetails => {
  const { latest } = stored
  const [one, five, fifteen] = latest.load

  return {
    ...toServerMetrics(stored),
    swap: { usedBytes: latest.swapUsedBytes, totalBytes: latest.swapTotalBytes },
    load: { one, five, fifteen },
    uptimeSeconds: latest.uptimeSeconds,
  }
}
