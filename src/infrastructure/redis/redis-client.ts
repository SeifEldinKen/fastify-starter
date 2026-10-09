import { Redis } from 'ioredis'
import Logger from '../../shared/logger.js'

const logger = new Logger('Redis')

// --> Owns the Redis connections and their lifecycle
export default class RedisClient {
  // --> Shared connection: normal commands for all services + PUBLISH for the Socket.IO adapter
  private readonly client: Redis

  // --> Dedicated connection for SUBSCRIBE (Socket.IO adapter).
  //     Once subscribed, a connection can't run normal commands, so it can never be the shared one.
  private readonly subscriber: Redis

  constructor(url: string) {
    this.client = new Redis(url, {
      // --> Connect in connect() instead of the constructor, so startup can await it
      lazyConnect: true,
    })

    // --> Same options (lazyConnect included), separate TCP connection
    this.subscriber = this.client.duplicate()

    RedisClient.logErrors(this.client, 'Client')
    RedisClient.logErrors(this.subscriber, 'Subscriber')
  }

  public async connect(): Promise<void> {
    const startedAt = performance.now()
    await Promise.all([this.client.connect(), this.subscriber.connect()])

    // --> host/port/db only, never the full URL (it can contain the password)
    const { host, port, db } = this.client.options
    const duration = Math.round(performance.now() - startedAt)
    logger.info(`🔌 Connected to ${host}:${port} (db ${db}) in ${duration}ms`)
  }

  // --> The shared ioredis instance, passed to services that need Redis
  public getClient(): Redis {
    return this.client
  }

  // --> Subscribe-only connection, for the Socket.IO adapter. Never run commands on it.
  public getSubscriber(): Redis {
    return this.subscriber
  }

  public async disconnect(): Promise<void> {
    await Promise.all([
      /* Disconnect both connections */
      RedisClient.close(this.subscriber),
      RedisClient.close(this.client),
    ])
  }

  private static async close(connection: Redis): Promise<void> {
    // --> Connected: wait for pending commands, then close
    if (connection.status === 'ready') {
      await connection.quit()
      return
    }

    // --> Not connected (e.g. still retrying): stop reconnecting immediately
    connection.disconnect()
  }

  private static logErrors(connection: Redis, name: string): void {
    // --> Without a listener, ioredis prints unhandled error events on every reconnect attempt
    connection.on('error', (error: NodeJS.ErrnoException) => {
      // --> err serializer also logs error.code (connection errors like ECONNREFUSED can have an empty message)
      logger.error(`${name} error`, error)
    })
  }
}
