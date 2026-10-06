// --> Single source of truth for permissions, the seed writes them to the Permission table
// never rename a key after release: it is the identifier stored in the database
interface PermissionDefinition {
  description: string
}

export const PERMISSIONS = {
  /* ORGANIZATION */
  'organization:update': { description: 'Edit organization settings' },
  'organization:delete': { description: 'Delete the organization' },

  'member:view': { description: 'View members' },
  'member:invite': { description: 'Invite members' },
  'member:update': { description: 'Change the role or status of a member' },
  'member:remove': { description: 'Remove members' },

  'role:manage': { description: 'Create, edit and delete custom roles' },

  'server:view': { description: 'View servers' },
  'server:create': { description: 'Add servers' },
  'server:update': { description: 'Edit servers' },
  'server:delete': { description: 'Delete servers' },
  'server:access-all': { description: 'Access every server of the organization without a per-server grant' },

  'file:view': { description: 'Browse and download files' },
  'file:create': { description: 'Upload files and create folders' },
  'file:update': { description: 'Edit, rename and move files' },
  'file:delete': { description: 'Delete files' },

  'system-user:view': { description: 'View Linux users' },
  'system-user:manage': { description: 'Create, edit and delete Linux users' },

  'audit-log:view': { description: 'View the audit log' },

  /* PLATFORM */
  'platform:user:view': { description: 'View all users' },
  'platform:user:block': { description: 'Block and unblock users' },
  'platform:organization:view': { description: 'View all organizations and their members' },
  'platform:organization:delete': { description: 'Delete organizations' },
  'platform:server:view': { description: 'View the servers of any organization' },
  'platform:audit-log:view': { description: 'View all audit logs' },
  'platform:role:manage': { description: 'Manage platform roles and who holds them' },
} as const satisfies Record<string, PermissionDefinition>

export type Permission = keyof typeof PERMISSIONS

// --> The key prefix decides the level: "platform:" for the platform team, anything else lives inside an organization
export type PlatformPermission = Extract<Permission, `platform:${string}`>
export type OrganizationPermission = Exclude<Permission, PlatformPermission>

export const isPlatformPermission = (permission: Permission): permission is PlatformPermission => {
  return permission.startsWith('platform:')
}

const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[]

export const PLATFORM_PERMISSIONS = ALL_PERMISSIONS.filter(isPlatformPermission)

export const ORGANIZATION_PERMISSIONS = ALL_PERMISSIONS.filter(
  (permission): permission is OrganizationPermission => !isPlatformPermission(permission),
)
