import { createHmac } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { getEnv } from '../../../shared/config/env-manager.js'
import type { CompareRequest, Hasher, HashRequest } from './hashing.types.js'

// --> Hashes and checks user passwords (bcrypt + pepper), not meant for anything else
export default class BcryptPasswordService implements Hasher {
  constructor(
    private readonly saltRounds: number = getEnv('BCRYPT_SALT_ROUNDS'),
    private readonly pepper: string = getEnv('PASSWORD_PEPPER'),
  ) {}

  public hash({ value }: HashRequest): Promise<string> {
    return bcrypt.hash(this.applyPepper(value), this.saltRounds)
  }

  public compare({ value, hash }: CompareRequest): Promise<boolean> {
    return bcrypt.compare(this.applyPepper(value), hash)
  }

  // --> The pepper lives in .env, not in the database: a leaked database alone is not enough to guess passwords
  // HMAC first (not password + pepper), so bcrypt's 72-byte limit never cuts the pepper or a long password
  private applyPepper(password: string): string {
    return createHmac('sha256', this.pepper).update(password).digest('base64')
  }
}
