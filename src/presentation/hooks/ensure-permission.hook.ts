import type { FastifyRequest } from 'fastify'
import type { PrismaClient } from '../../generated/prisma/client.js'
import { prismaDb } from '../../infrastructure/database/prisma.js'
import type { OrganizationPermission, PlatformPermission } from '../../shared/authorization/permissions.js'
import ForbiddenError from '../../shared/errors/forbidden.error.js'
import NotFoundError from '../../shared/errors/not-found.error.js'

type PermissionMode = 'all' | 'any'

// --> At least one list is needed, a request passes when it satisfies either of them
interface RequirePermissionRequest {
  // --> Checked against the member's role, the route must have :organizationId
  organization?: OrganizationPermission[]
  // --> Checked against the platform role of the user (the platform team, who are not members)
  platform?: PlatformPermission[]
  // --> 'all' (default): every listed permission is needed, 'any': one is enough. Applies to both lists
  mode?: PermissionMode
}

// --> How the request got in, with the role and permissions the hook already loaded
// "via" tells which of the two shapes it is, check it before reading membershipId
export type RequestAccess =
  | {
      via: 'membership'
      membershipId: string
      organizationId: string
      role: { key: string; rank: number }
      permissions: OrganizationPermission[]
    }
  | {
      via: 'platform'
      role: { key: string; rank: number }
      permissions: PlatformPermission[]
    }

declare module 'fastify' {
  interface FastifyRequest {
    access: RequestAccess
  }
}

// --> Answers "are you allowed?", always runs after EnsureAuthenticateHook
export default class EnsurePermissionHook {
  constructor(private readonly db: PrismaClient = prismaDb) {}

  // --> organization only: route inside an organization
  // organization + platform: the same route is also open to the platform team
  // platform only: admin route, no organization involved
  public require({ organization = [], platform = [], mode = 'all' }: RequirePermissionRequest) {
    // --> no permission at all would let everyone in, fail when the route is declared instead
    if (organization.length === 0 && platform.length === 0) {
      throw new Error('EnsurePermissionHook.require needs at least one permission')
    }

    return async (request: FastifyRequest): Promise<void> => {
      // --> get user and route params from request
      const { userId } = request.user
      const { organizationId, serverId } = request.params as { organizationId?: string; serverId?: string }

      // --> check that the server belongs to the organization of the route
      if (serverId && organizationId) {
        const server = await this.db.server.findFirst({
          where: { id: serverId, organizationId },
          select: { id: true },
        })

        if (!server) {
          throw new NotFoundError()
        }
      }

      // --> platform team: check the platform role of the user
      if (platform.length > 0) {
        const user = await this.db.user.findUnique({
          where: { id: userId },
          select: {
            platformRole: {
              select: {
                key: true,
                rank: true,
                permissions: { select: { permissionKey: true } },
              },
            },
          },
        })

        const platformRole = user?.platformRole

        // --> extract platform permissions (empty for regular customers)
        const platformPermissions = (platformRole?.permissions.map((item) => item.permissionKey) ??
          []) as PlatformPermission[]

        if (platformRole && this.hasPermissions(platformPermissions, platform, mode)) {
          // --> save access in request
          request.access = {
            via: 'platform',
            role: { key: platformRole.key, rank: platformRole.rank },
            permissions: platformPermissions,
          }

          return
        }

        // --> route for the platform team only
        if (organization.length === 0) {
          throw new ForbiddenError()
        }
      }

      // --> organization permissions need an organization in the route
      if (!organizationId) {
        throw new Error(`Route ${request.method} ${request.routeOptions.url} has no :organizationId parameter`)
      }

      // --> find membership with its role and permissions
      const membership = await this.db.membership.findUnique({
        where: { userId_organizationId: { userId, organizationId } },
        select: {
          id: true,
          status: true,
          role: {
            select: {
              key: true,
              rank: true,
              permissions: { select: { permissionKey: true } },
            },
          },
        },
      })

      // --> check if user is a member of the organization (404: a non-member must not learn it exists)
      if (!membership) {
        throw new NotFoundError()
      }

      // --> check if membership is suspended
      if (membership.status === 'SUSPENDED') {
        throw new ForbiddenError('MEMBERSHIP_SUSPENDED', 'Your membership in this organization is suspended')
      }

      // --> extract member permissions
      const permissions = membership.role.permissions.map((item) => item.permissionKey) as OrganizationPermission[]

      // --> check if member has the required permissions
      if (!this.hasPermissions(permissions, organization, mode)) {
        throw new ForbiddenError()
      }

      // --> check if member can access this server
      if (serverId && !permissions.includes('server:access-all')) {
        const serverAccess = await this.db.serverAccess.findUnique({
          where: { membershipId_serverId: { membershipId: membership.id, serverId } },
          select: { serverId: true },
        })

        if (!serverAccess) {
          throw new NotFoundError()
        }
      }

      // --> save access in request
      request.access = {
        via: 'membership',
        membershipId: membership.id,
        organizationId,
        role: { key: membership.role.key, rank: membership.role.rank },
        permissions,
      }
    }
  }

  private hasPermissions(granted: string[], required: string[], mode: PermissionMode): boolean {
    return mode === 'any'
      ? required.some((permission) => granted.includes(permission))
      : required.every((permission) => granted.includes(permission))
  }
}
