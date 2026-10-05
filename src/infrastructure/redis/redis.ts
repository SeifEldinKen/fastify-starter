import type { Redis } from 'ioredis'
import RedisClient from './redis-client.js'

// --> Single Redis connection for the whole app
// services take it through their constructor with getRedisClient() as default: `redis: Redis = getRedisClient()`
let redisClient: RedisClient | null = null

// --> Called once at startup, before any service is created
export async function initRedis(url: string): Promise<void> {
  if (redisClient) return

  const client = new RedisClient(url)

  try {
    await client.connect()
  } catch (error) {
    // --> Stop the background reconnect attempts
    await client.disconnect()
    throw error
  }

  // --> Saved only after a successful connection
  redisClient = client
}

// --> Call inside methods/constructors, never at the top of a file (runs before initRedis)
export function getRedisClient(): Redis {
  if (!redisClient) {
    throw new Error('Redis is not initialized. Call initRedis() first.')
  }

  return redisClient.getClient()
}

// --> Called on shutdown
export async function closeRedis(): Promise<void> {
  if (!redisClient) return

  await redisClient.disconnect()
  redisClient = null
}
