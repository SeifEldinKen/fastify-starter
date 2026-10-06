import { pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import type { Hasher } from './hashing.types.js'

const pbkdf2Async = promisify(pbkdf2)

// --> OWASP recommendation for PBKDF2-HMAC-SHA256
const ITERATIONS = 600_000
const KEY_LENGTH = 32
const DIGEST = 'sha256'

// --> For short secrets like verification codes
export default class Pbkdf2Service implements Hasher {
  public async hash(plain: string): Promise<string> {
    const salt = randomBytes(16)
    const derived = await pbkdf2Async(plain, salt, ITERATIONS, KEY_LENGTH, DIGEST)

    // --> Parameters are stored with the hash, so they can change later without breaking old hashes
    return `pbkdf2$${DIGEST}$${ITERATIONS}$${salt.toString('base64')}$${derived.toString('base64')}`
  }

  public async compare(plain: string, stored: string): Promise<boolean> {
    const [scheme, digest, iterations, salt, hash] = stored.split('$')

    if (scheme !== 'pbkdf2' || !digest || !iterations || !salt || !hash) return false

    const expected = Buffer.from(hash, 'base64')
    const derived = await pbkdf2Async(plain, Buffer.from(salt, 'base64'), Number(iterations), expected.length, digest)

    // --> Constant-time comparison: response time does not reveal how many bytes matched
    return timingSafeEqual(derived, expected)
  }
}
