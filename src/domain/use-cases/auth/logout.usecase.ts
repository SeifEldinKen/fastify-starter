import type { PrismaClient } from '../../../generated/prisma/client.js'
import { prismaDb } from '../../../infrastructure/database/prisma.js'

interface LogoutRequest {
  // --> From request.user, set by EnsureAuthenticateHook
  sessionId: string
}

// --> Ends one session: its access token and refresh token stop working immediately
export default class LogoutUseCase {
  constructor(private readonly db: PrismaClient = prismaDb) {}

  public async execute({ sessionId }: LogoutRequest): Promise<void> {
    // --> revoke the session, does nothing when it is already revoked
    await this.db.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
  }
}
