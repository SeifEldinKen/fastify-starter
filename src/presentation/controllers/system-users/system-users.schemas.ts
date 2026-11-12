import type { FastifySchema } from 'fastify'
import { z } from 'zod'
import {
  NEW_SYSTEM_GROUP_PATTERN,
  NEW_SYSTEM_USERNAME_PATTERN,
  SYSTEM_USERNAME_PATTERN,
} from '@/domain/use-cases/system-users/system-user.rules.js'
import { bearerAuth, errorResponseSchema, sudoPasswordHeaders } from '../shared.schemas.js'

const TAGS = ['System Users']

const serverParams = z.object({
  organizationId: z.uuid(),
  serverId: z.uuid(),
})

export type ServerParams = z.infer<typeof serverParams>

const systemUserSchema = z.object({
  username: z.string(),
  uid: z.number().int(),
  gid: z.number().int(),
  description: z.string(),
  home: z.string(),
  shell: z.string(),
  primaryGroup: z.string(),
  groups: z.array(z.string()).describe('The primary group first, then the other groups sorted by name'),
  isSystemAccount: z.boolean().describe('Account of the system or of a service, like www-data'),
  canLogin: z.boolean().describe('false when the shell is nologin or false'),
  hasSudo: z.boolean().describe('root, or member of the sudo, wheel or admin group'),
})

/* LIST */
const listSystemUsersQuery = z.object({
  // --> Query values are always text
  includeSystem: z.enum(['true', 'false']).default('false'),
})

export type ListSystemUsersQuery = z.infer<typeof listSystemUsersQuery>

export const listSystemUsersSchema: FastifySchema = {
  tags: TAGS,
  summary: 'List the Linux users of a server',
  security: bearerAuth,
  params: serverParams,
  querystring: listSystemUsersQuery,
  response: {
    200: z.object({
      total: z.number().int(),
      users: z.array(systemUserSchema),
    }),
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
    422: errorResponseSchema.describe('The server could not be reached, or it did not return its users'),
  },
}

/* GET */
const systemUserParams = serverParams.extend({
  // --> Goes into a command on the server, so only the characters of a Linux user name are accepted
  username: z.string().regex(SYSTEM_USERNAME_PATTERN, 'Not a valid Linux user name'),
})

export type SystemUserParams = z.infer<typeof systemUserParams>

const sshKeySchema = z.object({
  type: z.string(),
  fingerprint: z.string().describe('"SHA256:..." like `ssh-keygen -lf`'),
  comment: z.string(),
  options: z.string().nullable().describe('Restrictions written before the key, like from="203.0.113.0/24"'),
  publicKey: z.string(),
})

const systemUserDetailsSchema = systemUserSchema.extend({
  groups: z.array(z.object({ name: z.string(), gid: z.number().int() })),
  homeExists: z.boolean(),
  lastLogin: z
    .object({ at: z.iso.datetime(), from: z.string().nullable() })
    .nullable()
    .describe('null when the server does not record it, or the user never logged in'),
  activeSessions: z.array(z.object({ terminal: z.string(), from: z.string().nullable(), since: z.iso.datetime() })),
  processCount: z.number().int().nullable(),
  privileged: z
    .object({
      passwordStatus: z.enum(['set', 'locked', 'none']).nullable(),
      passwordChangedAt: z.iso.date().nullable(),
      passwordExpiresAt: z.iso.date().nullable(),
      accountExpiresAt: z.iso.date().nullable(),
      sshKeys: z.array(sshKeySchema).describe('Public keys allowed to log in as this user'),
    })
    .nullable()
    .describe('null when the service account has no root rights on the server'),
})

export const getSystemUserSchema: FastifySchema = {
  tags: TAGS,
  summary: 'Get the details of one Linux user',
  security: bearerAuth,
  params: systemUserParams,
  headers: sudoPasswordHeaders,
  response: {
    200: systemUserDetailsSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
    422: errorResponseSchema.describe('The server could not be reached, or it did not return the details'),
  },
}

/* CREATE */
const createSystemUserBody = z
  .object({
    username: z.string().regex(NEW_SYSTEM_USERNAME_PATTERN, 'Not a valid Linux user name'),
    description: z
      .string()
      .trim()
      .max(100)
      .regex(/^[^:,\p{Cc}]*$/u, 'Cannot contain ":" or "," or line breaks')
      .default(''),
    shell: z
      .string()
      .regex(/^\/[a-zA-Z0-9/_.-]{1,99}$/, 'Not a valid shell path')
      .default('/bin/bash'),
    createHome: z.boolean().default(true),
    groups: z.array(z.string().regex(NEW_SYSTEM_GROUP_PATTERN, 'Not a valid Linux group name')).max(20).default([]),
    sudo: z.boolean().default(false).describe('Adds the user to the sudo (or wheel) group of the server'),
    password: z
      .string()
      .min(8)
      .max(128)
      .regex(/^\P{Cc}*$/u, 'Cannot contain line breaks or control characters')
      .optional(),
    generatePassword: z.boolean().default(false).describe('The password is returned once, in this response only'),
    mustChangePassword: z.boolean().default(false).describe('The user must choose a new password on first login'),
    sshKeys: z.array(z.string().max(8192)).max(20).default([]).describe('Public keys, one "type key comment" each'),
  })
  .refine((body) => !(body.password !== undefined && body.generatePassword), {
    message: 'Send a password or ask for a generated one, not both',
  })
  .refine((body) => !body.mustChangePassword || body.password !== undefined || body.generatePassword, {
    message: 'A password is needed to force changing it',
  })
  .refine((body) => body.sshKeys.length === 0 || body.createHome, {
    message: 'SSH keys are saved in the home folder, it must be created',
  })

export type CreateSystemUserBody = z.infer<typeof createSystemUserBody>

export const createSystemUserSchema: FastifySchema = {
  tags: TAGS,
  summary: 'Create a Linux user on a server',
  security: bearerAuth,
  params: serverParams,
  headers: sudoPasswordHeaders,
  body: createSystemUserBody,
  response: {
    201: systemUserDetailsSchema.extend({
      generatedPassword: z.string().optional().describe('Only when generatePassword was true, never shown again'),
    }),
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
    409: errorResponseSchema,
    422: errorResponseSchema.describe('The server could not be reached, or the service account has no sudo'),
  },
}
