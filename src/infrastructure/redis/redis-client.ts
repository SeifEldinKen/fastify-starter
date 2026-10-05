import { Redis } from 'ioredis'
import Logger from '../../shared/logger.js'

const logger = new Logger('Redis')

// --> Owns the Redis connection and its lifecycle
export default class RedisClient {
  private readonly client: Redis

  constructor(url: string) {
    this.client = new Redis(url, {
      // --> Connect in connect() instead of the constructor, so startup can await it
      lazyConnect: true,
    })

    // --> Without a listener, ioredis prints unhandled error events on every reconnect attempt
    this.client.on('error', (error: NodeJS.ErrnoException) => {
      // --> err serializer also logs error.code (connection errors like ECONNREFUSED can have an empty message)
      logger.error('Client error', error)
    })
  }

  public async connect(): Promise<void> {
    const startedAt = performance.now()
    await this.client.connect()

    // --> host/port/db only, never the full URL (it can contain the password)
    const { host, port, db } = this.client.options
    const duration = Math.round(performance.now() - startedAt)
    logger.info(`🔌 Connected to ${host}:${port} (db ${db}) in ${duration}ms`)
  }

  // --> The ioredis instance, passed to services that need Redis
  public getClient(): Redis {
    return this.client
  }

  public async disconnect(): Promise<void> {
    // --> Connected: wait for pending commands, then close
    if (this.client.status === 'ready') {
      await this.client.quit()
      return
    }

    // --> Not connected (e.g. still retrying): stop reconnecting immediately
    this.client.disconnect()
  }
}
