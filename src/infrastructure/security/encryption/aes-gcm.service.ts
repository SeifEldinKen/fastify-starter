import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { getEnv } from '../../../shared/config/env-manager.js'
import DecryptionError from '../../../shared/errors/decryption.error.js'
import type { Encryptor } from './encryption.types.js'

const ALGORITHM = 'aes-256-gcm'
const KEY_VERSION = 'v1'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16

export default class AesGcmService implements Encryptor {
  constructor(private readonly key: Buffer = Buffer.from(getEnv('ENCRYPTION_KEY'), 'base64')) {}

  public encrypt(plain: string): string {
    // --> Random IV per call: encrypting the same value twice gives two different results
    const iv = randomBytes(IV_LENGTH)

    const cipher = createCipheriv(ALGORITHM, this.key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    })

    const ciphertext = Buffer.concat([
      /*  */
      cipher.update(plain, 'utf8'),
      cipher.final(),
    ])

    return [KEY_VERSION, iv, cipher.getAuthTag(), ciphertext]
      .map((part) => (typeof part === 'string' ? part : part.toString('base64')))
      .join(':')
  }

  public decrypt(encrypted: string): string {
    const [version, iv, authTag, ciphertext] = encrypted.split(':')

    if (version !== KEY_VERSION || !iv || !authTag || ciphertext === undefined) {
      throw new DecryptionError()
    }

    try {
      const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(iv, 'base64'), {
        authTagLength: AUTH_TAG_LENGTH,
      })
      decipher.setAuthTag(Buffer.from(authTag, 'base64'))

      // --> final() throws if the value was modified or encrypted with another key
      return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8')
    } catch (error) {
      throw new DecryptionError({ cause: error })
    }
  }
}
