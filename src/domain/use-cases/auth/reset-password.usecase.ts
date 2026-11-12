import type { PrismaClient } from '../../../generated/prisma/client.js'
import { prismaDb } from '../../../infrastructure/database/prisma.js'
import BcryptPasswordService from '../../../infrastructure/security/hashing/bcrypt-password.service.js'
import type { Hasher } from '../../../infrastructure/security/hashing/hashing.types.js'
import JwtService from '../../../infrastructure/security/jwt/jwt.service.js'
import type { ResetPasswordBody } from '../../../presentation/controllers/auth/auth.schemas.js'
import { getEnv } from '../../../shared/config/env-manager.js'
import InvalidTokenError from '../../../shared/errors/invalid-token.error.js'

// --> resetToken comes from VerifyResetOtpUseCase
interface ResetPasswordRequest extends ResetPasswordBody {}

// --> Sets the new password and ends every session of the user:
// a stolen refresh token or access token stops working immediately
export default class ResetPasswordUseCase {
  constructor(
    private readonly db: PrismaClient = prismaDb,
    private readonly passwordHasher: Hasher = new BcryptPasswordService(),
    private readonly jwtService: JwtService = new JwtService(),
  ) {}

  public async execute({ resetToken, newPassword }: ResetPasswordRequest): Promise<void> {
    // --> Throws InvalidTokenError (TOKEN_EXPIRED / TOKEN_INVALID)
    const payload = this.jwtService.verify({
      token: resetToken,
      secret: getEnv('JWT_RESET_SECRET'),
      type: 'reset',
    })

    // --> Never happens with a token we signed
    if (!payload.jti) {
      throw new InvalidTokenError('invalid')
    }

    const codeId = payload.jti
    const userId = payload.sub

    // --> hash password, outside the transaction: bcrypt is slow on purpose
    const passwordHash = await this.passwordHasher.hash({ value: newPassword })

    await this.db.$transaction(async (db) => {
      // --> the token must come from the newest code: requesting a new code kills the tokens of the older ones
      const newestCode = await db.verificationCode.findFirst({
        where: { userId, purpose: 'PASSWORD_RESET' },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      })

      if (newestCode?.id !== codeId) {
        throw new InvalidTokenError('invalid')
      }

      const now = new Date()

      // --> update password, only when it was not changed since the token was issued (iat is in seconds):
      // this is what makes the token single-use, the code row is kept as a record
      // access tokens issued before passwordChangedAt are rejected by EnsureAuthenticateHook
      const updated = await db.user.updateMany({
        where: {
          id: userId,
          OR: [{ passwordChangedAt: null }, { passwordChangedAt: { lt: new Date(payload.iat * 1000) } }],
        },
        data: { passwordHash, passwordChangedAt: now },
      })

      if (updated.count === 0) {
        throw new InvalidTokenError('invalid')
      }

      // --> revoke every open session
      await db.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      })
    })

    // TODO: send an email telling the user that the password was changed
  }
}
