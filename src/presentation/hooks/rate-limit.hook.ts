import { isIPv6 } from 'node:net'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Redis } from 'ioredis'
import { getRedisClient } from '@/infrastructure/redis/redis'
import TooManyRequestsError from '@/shared/errors/too-many-requests.error'
import Logger from '@/shared/logger'

interface RateLimit {
  name: string
  max: number
  windowSeconds: number
}

export default class RateLimitHook {
  constructor(
    private readonly redis: Redis = getRedisClient(),
    private readonly logger: Logger = new Logger('RateLimit'),
  ) {}

  public byIp(limit: RateLimit) {
    return this.handler(`${limit.name}:ip`, limit, (request) => normalizeIp(request.ip))
  }

  public byEmail(limit: RateLimit) {
    return this.handler(`${limit.name}:email`, limit, (request) =>
      (request.body as { email: string }).email.toLowerCase(),
    )
  }

  private handler(name: string, { max, windowSeconds }: RateLimit, key: (request: FastifyRequest) => string) {
    return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const redisKey = `rate-limit:${name}:${key(request)}`

      let count: number
      let ttlMs: number

      try {
        // --> one transaction: nothing is sent before exec(), and the counter can never exist without an expiry
        const transaction = this.redis.multi()

        // --> creates the counter with its expiry, only when it is missing
        transaction.set(redisKey, 0, 'PX', windowSeconds * 1000, 'NX')
        transaction.incr(redisKey)
        transaction.pttl(redisKey)

        // --> one [error, result] per command, in the same order
        const results = await transaction.exec()

        count = Number(results?.[1]?.[1])
        ttlMs = Number(results?.[2]?.[1])
      } catch {
        // --> Redis down: the request passes instead of failing (the error itself is logged by RedisClient)
        this.logger.warn('Rate limit skipped, Redis is not reachable', { name })
        return
      }

      if (count > max) {
        const retryAfterSeconds = Math.ceil(ttlMs / 1000)

        reply.header('retry-after', retryAfterSeconds)

        throw new TooManyRequestsError(retryAfterSeconds)
      }
    }
  }
}

// --> An IPv6 client owns a whole /64 block: counted by its first 4 groups, or it would never reach the limit
function normalizeIp(ip: string): string {
  if (!isIPv6(ip)) {
    return ip
  }

  // --> IPv4 written as IPv6 (::ffff:1.2.3.4)
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)

  if (mapped?.[1]) {
    return mapped[1]
  }

  // --> '::' stands for the missing zero groups, put them back to get the 8 groups
  const [head = '', tail = ''] = ip.toLowerCase().split('::')
  const headGroups = head ? head.split(':') : []
  const tailGroups = tail ? tail.split(':') : []
  const zeros = Array(8 - headGroups.length - tailGroups.length).fill('0')

  return [...headGroups, ...zeros, ...tailGroups].slice(0, 4).join(':')
}
