import { createHmac } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { getEnv } from '../../../shared/config/env-manager.js'
import type { Hasher } from './hashing.types.js'

// --> Hashes and checks user passwords (bcrypt + pepper), not meant for anything else
export default class BcryptPasswordService implements Hasher {
  constructor(
    private readonly saltRounds: number = getEnv('BCRYPT_SALT_ROUNDS'),
    private readonly pepper: string = getEnv('PASSWORD_PEPPER'),
  ) {}

  public hash(password: string): Promise<string> {
    return bcrypt.hash(this.applyPepper(password), this.saltRounds)
  }

  public compare(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(this.applyPepper(password), hash)
  }

  // --> The pepper lives in .env, not in the database: a leaked database alone is not enough to guess passwords
  // HMAC first (not password + pepper), so bcrypt's 72-byte limit never cuts the pepper or a long password
  private applyPepper(password: string): string {
    return createHmac('sha256', this.pepper).update(password).digest('base64')
  }
}
