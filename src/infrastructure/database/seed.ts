import { prismaDb } from '@/infrastructure/database/prisma.js'
import { PERMISSIONS } from '@/shared/authorization/permissions.js'
import { ORGANIZATION_ROLES, PLATFORM_ROLES } from '@/shared/authorization/roles.js'
import Logger from '@/shared/logger.js'

const logger = new Logger('Seed')

const MAX_LISTED_KEYS = 6

// --> "2 (file:view, file:create)", long lists are cut: "26 (a, b, c, d, e, f, +20 more)"
const formatKeys = (keys: string[]): string => {
  if (keys.length === 0) {
    return '0'
  }

  const listed = keys.slice(0, MAX_LISTED_KEYS)
  const hidden = keys.length - listed.length

  return `${keys.length} (${listed.join(', ')}${hidden > 0 ? `, +${hidden} more` : ''})`
}

// --> "+2 -1 permissions", or "no changes" when both are zero
const formatChanges = (added: number, removed: number): string => {
  return added === 0 && removed === 0 ? 'no changes' : `+${added} -${removed} permissions`
}

// --> Makes the database match the definitions in src/shared/authorization
// safe to run again and again: run it after every change to permissions.ts or roles.ts
const seed = async (): Promise<void> => {
  const startedAt = performance.now()
  const permissionKeys = Object.keys(PERMISSIONS)

  logger.info('🌱 Syncing the database with src/shared/authorization')

  await prismaDb.$transaction(async (db) => {
    /* PERMISSIONS */
    // --> read what is saved now, to report what this run changes
    const savedPermissions = await db.permission.findMany({ select: { key: true, description: true } })
    const savedDescriptions = new Map(savedPermissions.map(({ key, description }) => [key, description]))

    const added: string[] = []
    const updated: string[] = []

    // --> add new permissions, update the description of existing ones
    for (const [key, { description }] of Object.entries(PERMISSIONS)) {
      const savedDescription = savedDescriptions.get(key)

      if (savedDescription === undefined) {
        added.push(key)
      } else if (savedDescription !== description) {
        updated.push(key)
      }

      await db.permission.upsert({
        where: { key },
        create: { key, description },
        update: { description },
      })
    }

    // --> delete permissions removed from the code, their links to roles are deleted with them
    const removed = savedPermissions.map(({ key }) => key).filter((key) => !permissionKeys.includes(key))

    await db.permission.deleteMany({
      where: { key: { in: removed } },
    })

    logger.info(`🔑 Permissions: ${permissionKeys.length} defined in the code`)
    logger.info(`     added:   ${formatKeys(added)}`)
    logger.info(`     updated: ${formatKeys(updated)}`)
    logger.info(`     removed: ${formatKeys(removed)}`)

    /* PLATFORM ROLES */
    logger.info(`🛡️ Platform roles: ${Object.keys(PLATFORM_ROLES).length} defined in the code`)

    for (const [key, { name, rank, permissions }] of Object.entries(PLATFORM_ROLES)) {
      const existing = await db.platformRole.findUnique({
        where: { key },
        select: { id: true },
      })

      const role = await db.platformRole.upsert({
        where: { key },
        create: { key, name, rank, isSystem: true },
        update: { name, rank, isSystem: true },
        select: { id: true },
      })

      // --> remove permissions the role no longer has, then add the missing ones
      const removedLinks = await db.platformRolePermission.deleteMany({
        where: { platformRoleId: role.id, permissionKey: { notIn: [...permissions] } },
      })

      const addedLinks = await db.platformRolePermission.createMany({
        data: permissions.map((permissionKey) => ({ platformRoleId: role.id, permissionKey })),
        skipDuplicates: true,
      })

      const changes = existing ? formatChanges(addedLinks.count, removedLinks.count) : 'created'

      logger.info(`     ${key.padEnd(22)} ${String(permissions.length).padStart(2)} permissions   ${changes}`)
    }

    /* DEFAULT ROLES OF EXISTING ORGANIZATIONS */
    // --> custom roles (isSystem false) are never touched, only the default ones follow the code
    const organizations = await db.organization.findMany({ select: { id: true } })

    logger.info(
      `🏢 Organization roles: ${Object.keys(ORGANIZATION_ROLES).length} defined in the code, ${organizations.length} organizations in the database`,
    )

    for (const [key, { name, rank, permissions }] of Object.entries(ORGANIZATION_ROLES)) {
      let createdRoles = 0
      let skippedRoles = 0
      let addedLinks = 0
      let removedLinks = 0

      for (const { id: organizationId } of organizations) {
        const existing = await db.role.findUnique({
          where: { organizationId_key: { organizationId, key } },
          select: { id: true, isSystem: true },
        })

        // --> the organization created its own role with this key: leave it alone
        if (existing && !existing.isSystem) {
          skippedRoles++
          continue
        }

        // --> update the default role, or create it when it was added to the code after the organization
        const role = existing
          ? await db.role.update({ where: { id: existing.id }, data: { name, rank }, select: { id: true } })
          : await db.role.create({ data: { organizationId, key, name, rank, isSystem: true }, select: { id: true } })

        const removedFromRole = await db.rolePermission.deleteMany({
          where: { roleId: role.id, permissionKey: { notIn: [...permissions] } },
        })

        const addedToRole = await db.rolePermission.createMany({
          data: permissions.map((permissionKey) => ({ roleId: role.id, permissionKey })),
          skipDuplicates: true,
        })

        if (!existing) {
          createdRoles++
        }

        addedLinks += addedToRole.count
        removedLinks += removedFromRole.count
      }

      const details = [
        formatChanges(addedLinks, removedLinks),
        ...(createdRoles > 0 ? [`created in ${createdRoles} organizations`] : []),
        ...(skippedRoles > 0 ? [`skipped ${skippedRoles} custom roles with this key`] : []),
      ].join(', ')

      logger.info(`     ${key.padEnd(22)} ${String(permissions.length).padStart(2)} permissions   ${details}`)
    }
  })

  logger.info(`✅ Seed completed in ${Math.round(performance.now() - startedAt)}ms`)
}

seed()
  .catch((error) => {
    logger.fatal('Seed failed, nothing was changed', error)
    process.exitCode = 1
  })
  .finally(() => prismaDb.$disconnect())
