import type { Redis } from 'ioredis'
import RedisClient from './redis-client.js'

// --> Redis connections for the whole app (one shared client + one subscriber)
// services take the client through their constructor with getRedisClient() as default: `redis: Redis = getRedisClient()`
let redisClient: RedisClient | null = null

// --> Called once at startup, before any service is created
export async function initRedis(url: string): Promise<void> {
  if (redisClient) return

  const client = new RedisClient(url)

  try {
    await client.connect()
  } catch (error) {
    // --> Stop the background reconnect attempts (of both connections)
    await client.disconnect()
    throw error
  }

  // --> Saved only after a successful connection
  redisClient = client
}

// --> Call inside methods/constructors, never at the top of a file (runs before initRedis)
export function getRedisClient(): Redis {
  return requireRedis().getClient()
}

// --> Clients for the Socket.IO Redis adapter:
//     pub = the shared client (PUBLISH is a normal command, no extra connection needed)
//     sub = the dedicated subscriber connection
export function getRedisAdapterClients(): { pub: Redis; sub: Redis } {
  const redis = requireRedis()
  return {
    pub: redis.getClient(),
    sub: redis.getSubscriber(),
  }
}

// --> Called on shutdown, AFTER SocketServer.close() (the adapter unsubscribes through Redis)
export async function closeRedis(): Promise<void> {
  if (!redisClient) return

  await redisClient.disconnect()
  redisClient = null
}

function requireRedis(): RedisClient {
  if (!redisClient) {
    throw new Error('Redis is not initialized. Call initRedis() first.')
  }

  return redisClient
}
