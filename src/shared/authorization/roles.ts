import {
  ORGANIZATION_PERMISSIONS,
  type OrganizationPermission,
  PLATFORM_PERMISSIONS,
  type PlatformPermission,
} from './permissions.js'

interface RoleDefinition<P> {
  name: string
  rank: number
  permissions: readonly P[]
}

// --> Default roles copied into every organization when it is created
export const ORGANIZATION_ROLES = {
  owner: {
    name: 'Owner',
    rank: 100,
    permissions: ORGANIZATION_PERMISSIONS,
  },
  admin: {
    name: 'Admin',
    rank: 80,
    permissions: [
      'organization:update',
      'member:view',
      'member:invite',
      'member:update',
      'member:remove',
      'role:manage',
      'server:view',
      'server:create',
      'server:update',
      'server:delete',
      'server:access-all',
      'file:view',
      'file:create',
      'file:update',
      'file:delete',
      'system-user:view',
      'system-user:manage',
      'audit-log:view',
    ],
  },
  operator: {
    name: 'Operator',
    rank: 50,
    permissions: [
      'member:view',
      'server:view',
      'file:view',
      'file:create',
      'file:update',
      'file:delete',
      'system-user:view',
      'system-user:manage',
    ],
  },
  viewer: {
    name: 'Viewer',
    rank: 10,
    permissions: ['member:view', 'server:view', 'file:view', 'system-user:view'],
  },
} as const satisfies Record<string, RoleDefinition<OrganizationPermission>>

// --> Roles of the platform team, split by job so nobody needs full access to do one task
export const PLATFORM_ROLES = {
  'super-admin': {
    name: 'Super Admin',
    rank: 100,
    permissions: PLATFORM_PERMISSIONS,
  },
  'user-manager': {
    name: 'User Manager',
    rank: 50,
    permissions: ['platform:user:view', 'platform:user:block'],
  },
  'organization-manager': {
    name: 'Organization Manager',
    rank: 50,
    permissions: ['platform:organization:view', 'platform:organization:delete', 'platform:server:view'],
  },
  viewer: {
    name: 'Viewer',
    rank: 10,
    permissions: [
      'platform:user:view',
      'platform:organization:view',
      'platform:server:view',
      'platform:audit-log:view',
    ],
  },
} as const satisfies Record<string, RoleDefinition<PlatformPermission>>

export type OrganizationRoleKey = keyof typeof ORGANIZATION_ROLES
export type PlatformRoleKey = keyof typeof PLATFORM_ROLES

// --> Role of the user who creates an organization
export const ORGANIZATION_CREATOR_ROLE: OrganizationRoleKey = 'owner'

// --> Role of an invited member when the inviter does not choose one (least privilege)
export const DEFAULT_MEMBER_ROLE: OrganizationRoleKey = 'viewer'
