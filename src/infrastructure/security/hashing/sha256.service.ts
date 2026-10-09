import { createHash, timingSafeEqual } from 'node:crypto'
import type { CompareRequest, Hasher, HashRequest } from './hashing.types.js'

// --> For long random tokens (refresh tokens): no salt, so the same token always gives the same hash
// and a row can be found by it. Never use it for passwords or short codes
export default class Sha256Service implements Hasher {
  // --> Nothing here is asynchronous, the Promise only matches the Hasher interface
  public async hash({ value }: HashRequest): Promise<string> {
    return createHash('sha256').update(value).digest('hex')
  }

  public async compare({ value, hash }: CompareRequest): Promise<boolean> {
    const actual = Buffer.from(await this.hash({ value }))
    const expected = Buffer.from(hash)

    // --> timingSafeEqual throws on different lengths
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  }
}
