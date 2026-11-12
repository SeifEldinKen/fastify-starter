import type { FastifySchema } from 'fastify'
import { z } from 'zod'
import { MAX_FIREWALL_SOURCES } from '@/domain/use-cases/firewall/add-firewall-rules.usecase.js'
import {
  FIREWALL_ACTIONS,
  FIREWALL_BACKENDS,
  FIREWALL_COMMENT_PATTERN,
  isFirewallPort,
  isFirewallSource,
} from '@/domain/use-cases/firewall/firewall.rules.js'
import { FIREWALL_WARNING_CODES } from '@/domain/use-cases/firewall/get-firewall.usecase.js'
import { bearerAuth, errorResponseSchema, sudoPasswordHeaders } from '../shared.schemas.js'

const TAGS = ['Firewall']

const serverParams = z.object({
  organizationId: z.uuid(),
  serverId: z.uuid(),
})

export type ServerParams = z.infer<typeof serverParams>

const policySchema = z.enum(['allow', 'deny'])

const firewallRuleSchema = z.object({
  action: z.enum(FIREWALL_ACTIONS).describe('"reject" answers that the port is closed, "deny" stays silent'),
  direction: z.enum(['in', 'out']),
  port: z.string().nullable().describe('"443", a range "8000-8100", a list "80,443", null for every port'),
  protocol: z.enum(['tcp', 'udp', 'any']),
  source: z.string().describe('"any", one address, or a network like "10.0.0.0/8"'),
  ipVersion: z.enum(['v4', 'v6', 'both']),
  interface: z.string().nullable().describe('Only on this network card, null for all of them'),
  comment: z.string().nullable(),
  protected: z.boolean().describe('This rule lets the panel reach SSH, removing it could lock the panel out'),
})

const firewallSchema = z.object({
  backend: z
    .enum(FIREWALL_BACKENDS)
    .describe('The tool that manages the firewall: "raw" is rules written by hand, "none" is no firewall'),
  manageable: z.boolean().describe('false for "raw" and "none"'),
  enabled: z.boolean(),
  defaults: z
    .object({ incoming: policySchema, outgoing: policySchema })
    .nullable()
    .describe('What happens to a connection no rule matches'),
  sshPort: z.number().int().nullable().describe('The port the panel is connected to'),
  rules: z.array(firewallRuleSchema).describe('One source per rule, in the order of the firewall'),
  warnings: z.array(z.object({ code: z.enum(FIREWALL_WARNING_CODES), message: z.string() })),
})

/* GET */
export const getFirewallSchema: FastifySchema = {
  tags: TAGS,
  summary: 'Get the state and the rules of the firewall of a server',
  security: bearerAuth,
  params: serverParams,
  headers: sudoPasswordHeaders,
  response: {
    200: firewallSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
    422: errorResponseSchema.describe('The server could not be reached, or the service account has no sudo'),
  },
}

// --> Same answers on every route that changes the firewall
const changeErrorResponses = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  409: errorResponseSchema.describe('The rule already exists, or another change of this firewall is still running'),
  422: errorResponseSchema.describe(
    'The firewall cannot take the change: not managed by ufw or firewalld, the change would lock the panel out, or it was undone because the server stopped answering',
  ),
}

/* ADD RULES */
const addFirewallRulesBody = z
  .object({
    action: z.enum(['allow', 'deny']),
    port: z
      .string()
      .refine((port) => isFirewallPort(port), 'Not a valid port or range of ports')
      .optional()
      .describe('"443" or a range "8000-8100". Without it the rule is for every port, and needs sources'),
    protocol: z.enum(['tcp', 'udp']).default('tcp'),
    sources: z
      .array(z.string().refine(isFirewallSource, 'Not a valid address or network'))
      .max(MAX_FIREWALL_SOURCES)
      .default([])
      .describe('Addresses or networks like "10.0.0.0/8", one rule is added for each. Empty for everyone'),
    comment: z
      .string()
      .regex(FIREWALL_COMMENT_PATTERN, 'Holds characters that are not allowed')
      .default('')
      .describe('Saved by ufw only, firewalld has no comments'),
  })
  .refine((body) => body.port !== undefined || body.sources.length > 0, {
    message: 'A rule for every port needs at least one source',
  })

export type AddFirewallRulesBody = z.infer<typeof addFirewallRulesBody>

export const addFirewallRulesSchema: FastifySchema = {
  tags: TAGS,
  summary: 'Add incoming rules, undone by the server itself when they lock the panel out',
  security: bearerAuth,
  params: serverParams,
  headers: sudoPasswordHeaders,
  body: addFirewallRulesBody,
  response: {
    201: firewallSchema,
    ...changeErrorResponses,
  },
}

/* DELETE RULE */
// --> The rule is named by what it holds, as the GET route returns it
const deleteFirewallRuleQuery = z.object({
  action: z.enum(FIREWALL_ACTIONS),
  port: z
    .string()
    .refine((port) => isFirewallPort(port, { allowList: true }), 'Not a valid port')
    .optional()
    .describe('Leave out for a rule on every port'),
  protocol: z.enum(['tcp', 'udp', 'any']),
  source: z
    .string()
    .refine((source) => source === 'any' || isFirewallSource(source), 'Not a valid address or network')
    .default('any'),
})

export type DeleteFirewallRuleQuery = z.infer<typeof deleteFirewallRuleQuery>

export const deleteFirewallRuleSchema: FastifySchema = {
  tags: TAGS,
  summary: 'Delete one incoming rule, undone by the server itself when it locks the panel out',
  security: bearerAuth,
  params: serverParams,
  headers: sudoPasswordHeaders,
  querystring: deleteFirewallRuleQuery,
  response: {
    200: firewallSchema,
    ...changeErrorResponses,
  },
}
