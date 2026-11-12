import type { FastifyRequest } from 'fastify'
import type { PrismaClient } from '../../generated/prisma/client.js'
import { prismaDb } from '../../infrastructure/database/prisma.js'
import JwtService from '../../infrastructure/security/jwt/jwt.service.js'
import { getEnv } from '../../shared/config/env-manager.js'
import UnauthorizedError from '../../shared/errors/unauthorized.error.js'
import UserBlockedError from '../../shared/errors/user-blocked.error.js'
import Logger from '../../shared/logger.js'

export interface AuthenticatedUser {
  userId: string
  sessionId: string
  email: string
  firstName: string
  lastName: string
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthenticatedUser
  }
}

// --> Answers "who are you?" only, permissions are checked by a separate hook
export default class EnsureAuthenticateHook {
  constructor(
    private readonly jwtService: JwtService = new JwtService(),
    private readonly db: PrismaClient = prismaDb,
    private readonly logger: Logger = new Logger('Auth'),
  ) {}

  // --> Use in onRequest, so unauthenticated requests are rejected before their body is read
  public handler() {
    return async (request: FastifyRequest): Promise<void> => {
      // --> get the access token from the authorization header ("Bearer <token>")
      const authHeader = request.headers.authorization

      // --> extract the access token
      const accessToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined

      // --> check if the access token
      if (!accessToken) {
        this.logger.debug('Missing or malformed Authorization header', {
          method: request.method,
          url: request.url,
        })

        throw new UnauthorizedError()
      }

      // --> Throws InvalidTokenError (TOKEN_EXPIRED / TOKEN_INVALID)
      const payload = this.jwtService.verify({
        token: accessToken,
        secret: getEnv('JWT_ACCESS_SECRET'),
        type: 'access',
      })

      // --> One query for the session and its user
      const session = await this.db.session.findUnique({
        where: { id: payload.sid },
        select: {
          userId: true,
          revokedAt: true,
          user: {
            select: {
              passwordChangedAt: true,
              blockedAt: true,
            },
          },
        },
      })

      // --> Same fields on every rejection log, never the token itself
      const context = {
        userId: payload.sub,
        sessionId: payload.sid,
        method: request.method,
        url: request.url,
      }

      // --> Missing session = deleted user (sessions are deleted with the user), revoked = logout
      if (!session || session.revokedAt) {
        this.logger.info('Rejected: session not found or revoked', context)
        throw new UnauthorizedError()
      }

      // --> Never happens with a token we signed: a bug, or the secret leaked
      if (session.userId !== payload.sub) {
        this.logger.warn('Rejected: session does not belong to the token user', context)
        throw new UnauthorizedError()
      }

      if (session.user.blockedAt) {
        this.logger.warn('Rejected: user is blocked', context)
        throw new UserBlockedError()
      }

      // --> Token issued before the last password change (iat is in seconds)
      const { passwordChangedAt } = session.user

      if (passwordChangedAt && Math.floor(passwordChangedAt.getTime() / 1000) > payload.iat) {
        this.logger.info('Rejected: token issued before the last password change', context)
        throw new UnauthorizedError('Password has been changed, please log in again')
      }

      request.user = {
        userId: payload.sub,
        sessionId: payload.sid,
        email: payload.email,
        firstName: payload.firstName,
        lastName: payload.lastName,
      }
    }
  }
}
