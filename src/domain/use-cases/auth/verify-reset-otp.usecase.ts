import type { PrismaClient } from '../../../generated/prisma/client.js'
import { prismaDb } from '../../../infrastructure/database/prisma.js'
import type { Hasher } from '../../../infrastructure/security/hashing/hashing.types.js'
import HmacSha256Service from '../../../infrastructure/security/hashing/hmac-sha256.service.js'
import JwtService from '../../../infrastructure/security/jwt/jwt.service.js'
import type { VerifyResetOtpBody } from '../../../presentation/controllers/auth/auth.schemas.js'
import { getEnv } from '../../../shared/config/env-manager.js'
import InvalidVerificationCodeError from '../../../shared/errors/invalid-verification-code.error.js'

const MAX_ATTEMPTS = 5

interface VerifyResetOtpRequest extends VerifyResetOtpBody {}

interface VerifyResetOtpResponse {
  resetToken: string
}

// --> Exchanges a valid code for a reset token, the only thing ResetPasswordUseCase accepts
// every failure throws the same error, so the response never reveals whether the email is registered
export default class VerifyResetOtpUseCase {
  constructor(
    private readonly db: PrismaClient = prismaDb,
    private readonly codeHasher: Hasher = new HmacSha256Service(),
    private readonly jwtService: JwtService = new JwtService(),
  ) {}

  public async execute({ email, otp }: VerifyResetOtpRequest): Promise<VerifyResetOtpResponse> {
    // --> find user by email
    const user = await this.db.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: { id: true },
    })

    if (!user) {
      throw new InvalidVerificationCodeError()
    }

    // --> find the newest code, the older ones are only a record and are never accepted
    const verificationCode = await this.db.verificationCode.findFirst({
      where: { userId: user.id, purpose: 'PASSWORD_RESET' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, codeHash: true, usedAt: true, expiresAt: true },
    })

    if (!verificationCode || verificationCode.usedAt || verificationCode.expiresAt <= new Date()) {
      throw new InvalidVerificationCodeError()
    }

    // --> count the attempt before comparing, in one conditional update:
    // requests sent at the same time can never get more than MAX_ATTEMPTS guesses
    const attempt = await this.db.verificationCode.updateMany({
      where: {
        id: verificationCode.id,
        usedAt: null,
        attempts: { lt: MAX_ATTEMPTS },
      },
      data: { attempts: { increment: 1 } },
    })

    if (attempt.count === 0) {
      throw new InvalidVerificationCodeError()
    }

    // --> check code
    const isCodeValid = await this.codeHasher.compare({
      value: `${user.id}:${otp}`,
      hash: verificationCode.codeHash,
    })

    if (!isCodeValid) {
      throw new InvalidVerificationCodeError()
    }

    // --> mark as used, conditional again: the same code never gives two reset tokens
    const used = await this.db.verificationCode.updateMany({
      where: { id: verificationCode.id, usedAt: null },
      data: { usedAt: new Date() },
    })

    if (used.count === 0) {
      throw new InvalidVerificationCodeError()
    }

    // --> sign reset token, its jti is the id of the code: ResetPasswordUseCase rejects it once a newer code exists
    const resetToken = this.jwtService.sign({
      secret: getEnv('JWT_RESET_SECRET'),
      expiresIn: getEnv('JWT_RESET_TTL_SECONDS'),
      jwtid: verificationCode.id,
      payload: {
        type: 'reset',
        sub: user.id,
      },
    })

    return { resetToken }
  }
}
