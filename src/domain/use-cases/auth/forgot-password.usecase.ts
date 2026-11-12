import { randomInt } from 'node:crypto'
import type { PrismaClient } from '@prisma/client/extension'
import { prismaDb } from '@/infrastructure/database/prisma'
import type { Hasher } from '@/infrastructure/security/hashing/hashing.types'
import HmacSha256Service from '@/infrastructure/security/hashing/hmac-sha256.service'
import type { ForgotPasswordBody } from '@/presentation/controllers/auth/auth.schemas'
import { getEnv } from '@/shared/config/env-manager'
import Logger from '@/shared/logger'

const CODE_TTL_SECONDS = 600

interface ForgotPasswordRequest extends ForgotPasswordBody {}

// --> Creates a password reset code. Returns nothing on purpose:
export default class ForgotPasswordUseCase {
  constructor(
    private readonly db: PrismaClient = prismaDb,
    private readonly codeHasher: Hasher = new HmacSha256Service(),
    private readonly logger: Logger = new Logger('Auth'),
  ) {}

  public async execute({ email }: ForgotPasswordRequest): Promise<void> {
    // --> find user by email
    const user = await this.db.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: { id: true, blockedAt: true },
    })

    // --> unknown email or blocked user: stop silently
    if (!user || user.blockedAt) {
      return
    }

    // --> 6 digits, leading zeros kept
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0')

    // --> hashed together with the user id, so a hash copied to another user's row never matches
    const codeHash = await this.codeHasher.hash({
      value: `${user.id}:${code}`,
    })

    // --> older codes are kept as a record, only the newest one is ever accepted:
    // creating this one is what kills them (and the reset tokens issued from them)
    await this.db.verificationCode.create({
      data: {
        userId: user.id,
        purpose: 'PASSWORD_RESET',
        codeHash,
        expiresAt: new Date(Date.now() + CODE_TTL_SECONDS * 1000),
      },
    })

    // TODO: send the code by email. Do not await it here: the response time would reveal that the email is registered

    // --> until emails are sent, the code is only readable in the development log
    if (getEnv('NODE_ENV') === 'development') {
      this.logger.debug(`Password reset code: ${code}`, { userId: user.id })
    }
  }
}
