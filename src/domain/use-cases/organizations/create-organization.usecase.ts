import { randomBytes } from 'node:crypto'
import type { PrismaClient } from '@/generated/prisma/client.js'
import { prismaDb } from '@/infrastructure/database/prisma.js'
import { ORGANIZATION_CREATOR_ROLE, ORGANIZATION_ROLES } from '@/shared/authorization/roles.js'

interface CreateOrganizationRequest {
  // --> From request.user, set by EnsureAuthenticateHook
  userId: string
  name: string
}

interface CreateOrganizationResponse {
  id: string
  name: string
  slug: string
  role: { key: string; name: string }
}

// --> Creates the organization with its default roles, the creator becomes its owner
export default class CreateOrganizationUseCase {
  constructor(private readonly db: PrismaClient = prismaDb) {}

  public async execute({ userId, name }: CreateOrganizationRequest): Promise<CreateOrganizationResponse> {
    // --> build the slug from the name: "Acme Corp" -> "acme-corp"
    const baseSlug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')

    // --> check if the slug is free, a name without latin letters gives an empty slug
    const isSlugTaken =
      baseSlug === '' ||
      (await this.db.organization.findUnique({
        where: { slug: baseSlug },
        select: { id: true },
      })) !== null

    // --> taken or empty: add a short random ending
    const slug = isSlugTaken ? `${baseSlug || 'organization'}-${randomBytes(3).toString('hex')}` : baseSlug

    // --> everything or nothing: an organization without roles or without an owner must never exist
    return this.db.$transaction(async (db) => {
      // --> create organization
      const organization = await db.organization.create({
        data: { name, slug },
        select: {
          id: true,
          name: true,
          slug: true,
        },
      })

      // --> copy the default roles into the organization (the permissions themselves come from the seed)
      for (const [key, role] of Object.entries(ORGANIZATION_ROLES)) {
        await db.role.create({
          data: {
            organizationId: organization.id,
            key,
            name: role.name,
            rank: role.rank,
            isSystem: true,
            permissions: {
              create: role.permissions.map((permissionKey) => ({
                permissionKey,
              })),
            },
          },
        })
      }

      // --> find the role of the creator
      const creatorRole = await db.role.findUniqueOrThrow({
        where: {
          organizationId_key: {
            organizationId: organization.id,
            key: ORGANIZATION_CREATOR_ROLE,
          },
        },
        select: {
          id: true,
          key: true,
          name: true,
        },
      })

      // --> add the creator as a member
      await db.membership.create({
        data: {
          organizationId: organization.id,
          userId,
          roleId: creatorRole.id,
        },
      })

      return {
        ...organization,
        role: {
          key: creatorRole.key,
          name: creatorRole.name,
        },
      }
    })
  }
}
