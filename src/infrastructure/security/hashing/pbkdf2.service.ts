import { pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import type { CompareRequest, Hasher, HashRequest } from './hashing.types.js'

const pbkdf2Async = promisify(pbkdf2)

// --> OWASP recommendation for PBKDF2-HMAC-SHA256
const ITERATIONS = 600_000
const KEY_LENGTH = 32
const DIGEST = 'sha256'

// --> For short secrets like verification codes
export default class Pbkdf2Service implements Hasher {
  public async hash({ value }: HashRequest): Promise<string> {
    const salt = randomBytes(16)
    const derived = await pbkdf2Async(value, salt, ITERATIONS, KEY_LENGTH, DIGEST)

    // --> Parameters are stored with the hash, so they can change later without breaking old hashes
    return `pbkdf2$${DIGEST}$${ITERATIONS}$${salt.toString('base64')}$${derived.toString('base64')}`
  }

  public async compare({ value, hash }: CompareRequest): Promise<boolean> {
    const [scheme, digest, iterations, salt, storedKey] = hash.split('$')

    if (scheme !== 'pbkdf2' || !digest || !iterations || !salt || !storedKey) return false

    const expected = Buffer.from(storedKey, 'base64')
    const derived = await pbkdf2Async(value, Buffer.from(salt, 'base64'), Number(iterations), expected.length, digest)

    // --> Constant-time comparison: response time does not reveal how many bytes matched
    return timingSafeEqual(derived, expected)
  }
}
