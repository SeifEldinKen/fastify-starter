import type { MembershipStatus, PrismaClient } from '@/generated/prisma/client.js'
import { prismaDb } from '@/infrastructure/database/prisma.js'

interface ListMyOrganizationsRequest {
  // --> From request.user, set by EnsureAuthenticateHook
  userId: string
}

interface MyOrganization {
  // --> SUSPENDED organizations are listed too, so the user sees why they cannot open them
  status: MembershipStatus
  organization: { id: string; name: string; slug: string }
  role: { key: string; name: string }
}

// --> The organizations the user is a member of, with their role in each one
export default class ListMyOrganizationsUseCase {
  constructor(private readonly db: PrismaClient = prismaDb) {}

  public async execute({ userId }: ListMyOrganizationsRequest): Promise<MyOrganization[]> {
    // --> find memberships with their organization and role
    const memberships = await this.db.membership.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: {
        status: true,
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
        role: {
          select: {
            key: true,
            name: true,
          },
        },
      },
    })

    return memberships.map(({ organization, role, status }) => ({
      status,
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
      },
      role: {
        key: role.key,
        name: role.name,
      },
    }))
  }
}
