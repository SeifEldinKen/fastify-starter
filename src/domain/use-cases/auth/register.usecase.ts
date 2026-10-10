import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js'
import { prismaDb } from '../../../infrastructure/database/prisma.js'
import BcryptPasswordService from '../../../infrastructure/security/hashing/bcrypt-password.service.js'
import type { Hasher } from '../../../infrastructure/security/hashing/hashing.types.js'
import type { RegisterBody } from '../../../presentation/controllers/auth/auth.schemas.js'
import ConflictError from '../../../shared/errors/conflict.error.js'

interface RegisterRequest extends RegisterBody {}

interface RegisterResponse {
  id: string
  email: string
  firstName: string
  lastName: string
}

// --> Creates the account only, the user logs in afterwards with LoginUseCase
export default class RegisterUseCase {
  constructor(
    private readonly db: PrismaClient = prismaDb,
    private readonly passwordHasher: Hasher = new BcryptPasswordService(),
  ) {}

  public async execute({ email, firstName, lastName, password }: RegisterRequest): Promise<RegisterResponse> {
    // --> same email whatever the letter case or the spaces around it
    const normalizedEmail = email.trim().toLowerCase()

    // --> check if email is already registered
    const existing = await this.db.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    })

    if (existing) {
      throw new ConflictError('EMAIL_ALREADY_EXISTS', 'This email is already registered')
    }

    // --> hash password
    const passwordHash = await this.passwordHasher.hash({ value: password })

    // --> create user
    try {
      return await this.db.user.create({
        data: {
          email: normalizedEmail,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          passwordHash,
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
        },
      })
    } catch (error) {
      // --> two requests with the same email at the same time: the unique index rejects the second one
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('EMAIL_ALREADY_EXISTS', 'This email is already registered')
      }

      throw error
    }
  }
}
