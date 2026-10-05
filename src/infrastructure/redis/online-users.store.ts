import type { Redis } from 'ioredis'
import { getRedisClient } from './redis.js'

// --> Hash: userId -> number of open connections (a user with 2 tabs has 2)
const KEY = 'online:users'

// --> Decrement and delete in one atomic step, so a reconnect in between can't be lost
const REMOVE_SCRIPT = `
local count = redis.call('HINCRBY', KEYS[1], ARGV[1], -1)
if count <= 0 then
  redis.call('HDEL', KEYS[1], ARGV[1])
end
return count
`

// --> Online users tracking, filled automatically by SocketGateway on connect/disconnect
export default class OnlineUsersStore {
  constructor(private readonly redis: Redis = getRedisClient()) {}

  // --> Called once per connection
  public async add(userId: string): Promise<void> {
    await this.redis.hincrby(KEY, userId, 1)
  }

  // --> Called once per disconnection, the user stays online while another tab is open
  public async remove(userId: string): Promise<void> {
    await this.redis.eval(REMOVE_SCRIPT, 1, KEY, userId)
  }

  public async isOnline(userId: string): Promise<boolean> {
    return (await this.redis.hexists(KEY, userId)) === 1
  }

  public async getAll(): Promise<string[]> {
    return this.redis.hkeys(KEY)
  }

  public async count(): Promise<number> {
    return this.redis.hlen(KEY)
  }

  // --> Called on startup: entries left by a previous run (crash, restart) are stale
  public async clear(): Promise<void> {
    await this.redis.del(KEY)
  }
}
