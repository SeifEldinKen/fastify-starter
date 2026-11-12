import { randomUUID } from 'node:crypto'
import type { PrismaClient } from '@/generated/prisma/client.js'
import { prismaDb } from '@/infrastructure/database/prisma.js'
import BcryptPasswordService from '@/infrastructure/security/hashing/bcrypt-password.service.js'
import type { Hasher } from '@/infrastructure/security/hashing/hashing.types.js'
import Sha256Service from '@/infrastructure/security/hashing/sha256.service.js'
import JwtService from '@/infrastructure/security/jwt/jwt.service.js'
import type { LoginBody } from '@/presentation/controllers/auth/auth.schemas.js'
import { getEnv } from '@/shared/config/env-manager.js'
import InvalidCredentialsError from '@/shared/errors/invalid-credentials.error.js'
import UserBlockedError from '@/shared/errors/user-blocked.error.js'
import GetCurrentUserUseCase from './get-current-user.usecase.js'

interface LoginRequest extends LoginBody {
  // --> Not in the body: read from the request by the controller
  userAgent?: string
  ipAddress?: string
}

interface LoginResponse {
  accessToken: string
  refreshToken: string
  user: {
    id: string
    email: string
    firstName: string
    lastName: string
  }
}

// --> Checks email and password, opens a session and returns its two tokens
export default class LoginUseCase {
  // --> Compared against when the email is unknown, created on first use
  private dummyPasswordHash?: string

  constructor(
    private readonly db: PrismaClient = prismaDb,
    private readonly passwordHasher: Hasher = new BcryptPasswordService(),
    private readonly tokenHasher: Hasher = new Sha256Service(),
    private readonly jwtService: JwtService = new JwtService(),
    private readonly getCurrentUserUseCase: GetCurrentUserUseCase = new GetCurrentUserUseCase(),
  ) {}

  public async execute({ email, password, userAgent, ipAddress }: LoginRequest): Promise<LoginResponse> {
    // --> find user by email
    const user = await this.db.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        passwordHash: true,
        blockedAt: true,
      },
    })

    // --> unknown email: compare anyway, so the response time does not reveal that the email is not registered
    if (!user) {
      this.dummyPasswordHash ??= await this.passwordHasher.hash({ value: randomUUID() })

      await this.passwordHasher.compare({
        value: password,
        hash: this.dummyPasswordHash,
      })

      throw new InvalidCredentialsError()
    }

    // --> check password
    const isPasswordValid = await this.passwordHasher.compare({
      value: password,
      hash: user.passwordHash,
    })

    if (!isPasswordValid) {
      throw new InvalidCredentialsError()
    }

    // --> check if user is blocked (after the password, only the owner of the account learns it)
    if (user.blockedAt) {
      throw new UserBlockedError()
    }

    // --> sign refresh token, the session id is created here because the token carries it
    const sessionId = randomUUID()
    const refreshTtlSeconds = getEnv('JWT_REFRESH_TTL_SECONDS')

    const refreshToken = this.jwtService.sign({
      secret: getEnv('JWT_REFRESH_SECRET'),
      expiresIn: refreshTtlSeconds,
      jwtid: randomUUID(),
      payload: {
        type: 'refresh',
        sub: user.id,
        sid: sessionId,
      },
    })

    // --> convert refresh token to hash
    const refreshTokenHash = await this.tokenHasher.hash({
      value: refreshToken,
    })

    // --> create session, only the hash of the refresh token is saved
    await this.db.session.create({
      data: {
        id: sessionId,
        userId: user.id,
        refreshTokenHash,
        userAgent: userAgent ?? null,
        ipAddress: ipAddress ?? null,
        expiresAt: new Date(Date.now() + refreshTtlSeconds * 1000),
      },
    })

    // --> sign access token
    const accessToken = this.jwtService.sign({
      secret: getEnv('JWT_ACCESS_SECRET'),
      expiresIn: getEnv('JWT_ACCESS_TTL_SECONDS'),
      payload: {
        type: 'access',
        sub: user.id,
        sid: sessionId,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    })

    // --> format login
    const loginFormatted = {
      accessToken,
      refreshToken,
      user: await this.getCurrentUserUseCase.execute({
        userId: user.id,
      }),
    }

    return loginFormatted
  }
}
