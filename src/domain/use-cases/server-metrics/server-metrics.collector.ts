import ServerMetricsStore, { type ServerMetricsSample } from '@/infrastructure/redis/server-metrics.store.js'
import {
  readServerMetricsScript,
  SERVER_METRICS_MARKER,
} from '@/infrastructure/ssh/scripts/read-server-metrics.script.js'
import type SshCommandRunner from '@/infrastructure/ssh/ssh-command.runner.js'
import { sshCommandRunner } from '@/infrastructure/ssh/ssh-command.runner.js'
import type SshConnectionManager from '@/infrastructure/ssh/ssh-connection.manager.js'
import { sshConnectionManager } from '@/infrastructure/ssh/ssh-connection.manager.js'
import Logger from '@/shared/logger.js'

// --> How often the servers are read
export const SERVER_METRICS_INTERVAL_SECONDS = 15

// --> A server slower than this is skipped for this round, it never holds back the others
const READ_TIMEOUT_MS = 5_000

// --> The "cpu" line of /proc/stat: time spent in each state since the server started
interface CpuTimes {
  total: number
  idle: number
}

interface CollectorOptions {
  intervalSeconds?: number
}

// --> Reads the load of every server with an open connection, in this instance of the app, and saves it in Redis
// no connection is opened for it, and reading does not keep a connection open: an unused one still closes
export default class ServerMetricsCollector {
  private readonly intervalMs: number
  private timer: NodeJS.Timeout | undefined
  private isCollecting = false
  // --> The last CPU times of each server: the use of the CPU is the difference between two readings
  private readonly previousCpu = new Map<string, CpuTimes>()

  constructor(
    private readonly store: ServerMetricsStore = new ServerMetricsStore(),
    private readonly manager: Pick<SshConnectionManager, 'getOpenConnections'> = sshConnectionManager,
    private readonly commandRunner: SshCommandRunner = sshCommandRunner,
    private readonly logger: Logger = new Logger('ServerMetrics'),
    { intervalSeconds = SERVER_METRICS_INTERVAL_SECONDS }: CollectorOptions = {},
  ) {
    this.intervalMs = intervalSeconds * 1000
  }

  public start(): void {
    if (this.timer) {
      return
    }

    this.timer = setInterval(() => void this.collect(), this.intervalMs)
    // --> the timer never keeps the process alive on its own
    this.timer.unref()
  }

  public stop(): void {
    clearInterval(this.timer)
    this.timer = undefined
  }

  // --> One round over every open connection, all servers at the same time
  public async collect(): Promise<void> {
    // --> a round still running is not doubled
    if (this.isCollecting) {
      return
    }

    this.isCollecting = true

    try {
      const open = this.manager.getOpenConnections()
      const openIds = new Set(open.map(({ serverId }) => serverId))

      // --> forget the CPU times of closed connections: after a reconnection the first reading starts again
      for (const serverId of this.previousCpu.keys()) {
        if (!openIds.has(serverId)) {
          this.previousCpu.delete(serverId)
        }
      }

      await Promise.allSettled(
        open.map(async ({ serverId, connection }) => {
          try {
            const { stdout } = await this.commandRunner.runScript(connection, {
              ...readServerMetricsScript(),
              timeoutMs: READ_TIMEOUT_MS,
            })

            const sample = this.parse(serverId, stdout)

            if (sample) {
              await this.store.add(serverId, sample)
            }
          } catch (error) {
            this.logger.debug('Reading the load of a server failed', {
              serverId,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }),
      )
    } finally {
      this.isCollecting = false
    }
  }

  // --> Turns the output of the script into one reading, null when the output is not complete
  private parse(serverId: string, stdout: string): ServerMetricsSample | null {
    // --> split the output into its parts: name -> lines
    const parts = new Map<string, string[]>()

    for (const part of stdout.split(SERVER_METRICS_MARKER).slice(1)) {
      const [name = '', ...lines] = part.split('\n').map((line) => line.trim())

      parts.set(
        name,
        lines.filter((line) => line !== ''),
      )
    }

    if (!parts.has('END')) {
      return null
    }

    // --> parse CPU: "cpu user nice system idle iowait irq softirq steal guest guest_nice", in ticks
    // guest times are already part of user and nice, they are not added twice
    const [label, ...ticks] = (parts.get('STAT')?.[0] ?? '').split(/\s+/)
    const times = ticks.slice(0, 8).map(Number)

    if (label !== 'cpu' || times.length < 4 || times.some((time) => !Number.isFinite(time))) {
      return null
    }

    const current: CpuTimes = {
      total: times.reduce((sum, time) => sum + time, 0),
      // --> idle and iowait: waiting for the disk is not work of the CPU
      idle: (times[3] ?? 0) + (times[4] ?? 0),
    }

    const previous = this.previousCpu.get(serverId)
    const totalDelta = previous ? current.total - previous.total : 0

    this.previousCpu.set(serverId, current)

    const cpuPercent =
      previous && totalDelta > 0
        ? Math.round(
            Math.min(100, Math.max(0, ((totalDelta - (current.idle - previous.idle)) / totalDelta) * 100)) * 10,
          ) / 10
        : null

    // --> parse memory: "MemTotal:  4045396 kB"
    const memory = new Map<string, number>()

    for (const line of parts.get('MEMORY') ?? []) {
      const [key = '', value = ''] = line.split(/:\s+/)

      memory.set(key, Number.parseInt(value, 10) * 1024)
    }

    const memoryTotalBytes = memory.get('MemTotal') ?? 0

    // --> MemAvailable counts the cache the system frees when it needs it. Old kernels miss it
    const memoryAvailableBytes =
      memory.get('MemAvailable') ??
      (memory.get('MemFree') ?? 0) + (memory.get('Buffers') ?? 0) + (memory.get('Cached') ?? 0)

    if (memoryTotalBytes <= 0) {
      return null
    }

    // --> parse the rest: "0.52 0.58 0.59 1/389 12345", "350735.47 1374253.11", "4"
    const [one = 0, five = 0, fifteen = 0] = (parts.get('LOAD')?.[0] ?? '').split(/\s+/).slice(0, 3).map(Number)
    const uptimeSeconds = Number.parseFloat(parts.get('UPTIME')?.[0] ?? '0')
    const cores = Number.parseInt(parts.get('CORES')?.[0] ?? '0', 10)

    return {
      at: new Date().toISOString(),
      cores: cores > 0 ? cores : 1,
      cpuPercent,
      memoryUsedBytes: Math.max(0, memoryTotalBytes - memoryAvailableBytes),
      memoryTotalBytes,
      swapUsedBytes: Math.max(0, (memory.get('SwapTotal') ?? 0) - (memory.get('SwapFree') ?? 0)),
      swapTotalBytes: memory.get('SwapTotal') ?? 0,
      load: [one, five, fifteen].map((value) => (Number.isFinite(value) ? value : 0)) as [number, number, number],
      uptimeSeconds: Number.isFinite(uptimeSeconds) ? Math.floor(uptimeSeconds) : 0,
    }
  }
}
