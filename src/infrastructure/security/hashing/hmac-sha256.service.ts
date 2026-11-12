import { createHmac, timingSafeEqual } from 'node:crypto'
import { getEnv } from '../../../shared/config/env-manager.js'
import type { CompareRequest, Hasher, HashRequest } from './hashing.types.js'

// --> For short random codes (OTP): a 6-digit code has only a million values, so slowing the hash down does not protect it
// the secret lives in .env, not in the database: a leaked database alone is not enough to guess the code
export default class HmacSha256Service implements Hasher {
  constructor(private readonly secret: string = getEnv('VERIFICATION_CODE_SECRET')) {}

  // --> Nothing here is asynchronous, the Promise only matches the Hasher interface
  public async hash({ value }: HashRequest): Promise<string> {
    return createHmac('sha256', this.secret).update(value).digest('hex')
  }

  public async compare({ value, hash }: CompareRequest): Promise<boolean> {
    const actual = Buffer.from(await this.hash({ value }))
    const expected = Buffer.from(hash)

    // --> timingSafeEqual throws on different lengths
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  }
}
