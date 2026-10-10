import type { PrismaClient } from '../../../generated/prisma/client.js'
import { prismaDb } from '../../../infrastructure/database/prisma.js'
import NotFoundError from '../../../shared/errors/not-found.error.js'

interface GetCurrentUserRequest {
  // --> From request.user, set by EnsureAuthenticateHook
  userId: string
}

interface GetCurrentUserResponse {
  id: string
  email: string
  firstName: string
  lastName: string
  isEmailVerified: boolean
}

// --> Reads the user from the database, not from the access token: the token keeps the old name until it is renewed
export default class GetCurrentUserUseCase {
  constructor(private readonly db: PrismaClient = prismaDb) {}

  public async execute({ userId }: GetCurrentUserRequest): Promise<GetCurrentUserResponse> {
    // --> find user
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, firstName: true, lastName: true, emailVerifiedAt: true },
    })

    // --> deleted between the authentication hook and this query
    if (!user) {
      throw new NotFoundError('User not found')
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      isEmailVerified: user.emailVerifiedAt !== null,
    }
  }
}
