import type { FastifySchema } from 'fastify'
import { z } from 'zod'
import { SERVER_METRICS_HISTORY_RANGE_NAMES } from '@/domain/use-cases/server-metrics/server-metrics.rules.js'
import { bearerAuth, errorResponseSchema } from '../shared.schemas.js'

const TAGS = ['Servers']

const serverSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  host: z.string(),
  port: z.number().int(),
  username: z.string(),
  // --> "SHA256:..." like `ssh-keygen -lf`, shown so the owner can compare it with the real server
  hostFingerprint: z.string(),
})

const organizationParams = z.object({
  organizationId: z.uuid(),
})

const serverParams = organizationParams.extend({
  serverId: z.uuid(),
})

export type OrganizationParams = z.infer<typeof organizationParams>
export type ServerParams = z.infer<typeof serverParams>

// --> The load of a server, read in the background every few seconds while it is connected
const serverMetricsSchema = z.object({
  sampledAt: z.iso.datetime().describe('When the last reading was taken, an old date means the connection is closed'),
  intervalSeconds: z.number().int().describe('Time between two readings'),
  cpu: z.object({
    percent: z.number().nullable().describe('0 to 100, null for the first reading after a connection'),
    cores: z.number().int(),
  }),
  memory: z.object({
    usedBytes: z.number().int(),
    totalBytes: z.number().int(),
  }),
  history: z
    .array(
      z.object({
        at: z.iso.datetime(),
        cpuPercent: z.number().nullable(),
        memoryUsedBytes: z.number().int(),
      }),
    )
    .describe('The oldest first, empty without the "history" query'),
})

const serverMetricsDetailsSchema = serverMetricsSchema.extend({
  swap: z.object({
    usedBytes: z.number().int(),
    totalBytes: z.number().int(),
  }),
  load: z
    .object({ one: z.number(), five: z.number(), fifteen: z.number() })
    .describe('Average number of waiting tasks over 1, 5 and 15 minutes'),
  uptimeSeconds: z.number().int(),
})

const metricsQuery = z.object({
  history: z
    .enum(SERVER_METRICS_HISTORY_RANGE_NAMES)
    .optional()
    .describe('Add the readings of this range to draw a line, leave out for the last reading only'),
})

export type MetricsQuery = z.infer<typeof metricsQuery>

// --> Same answers on every route of one server
const serverErrorResponses = {
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
}

/* CREATE */
const createServerBody = z.object({
  name: z.string().trim().min(1).max(100),
  // --> A host name or an IP address
  host: z.union([z.hostname(), z.ipv4(), z.ipv6()]).pipe(z.string().max(253)),
  port: z.number().int().min(1).max(65535).default(22),
  // --> Linux user name rules
  username: z.string().regex(/^[a-z_][a-z0-9_-]{0,31}$/, 'Not a valid Linux user name'),
  // --> The whole key file, never returned by any route
  privateKey: z.string().min(1).max(16_384).optional(),
  // --> Used once to add a new key of the panel to the account, then forgotten: never saved, never returned
  password: z
    .string()
    .min(1)
    .max(1024)
    .optional()
    .describe('Instead of privateKey: the panel signs in once, adds its own key to the account, and forgets it'),
})

// --> One way to sign in, not both
const createServerBodyWithCredential = createServerBody.refine(
  (body) => (body.privateKey === undefined) !== (body.password === undefined),
  'Send either privateKey or password',
)

export type CreateServerBody = z.infer<typeof createServerBodyWithCredential>

export const createServerSchema: FastifySchema = {
  tags: TAGS,
  summary: 'Add a server, the connection is tested before it is saved',
  security: bearerAuth,
  params: organizationParams,
  body: createServerBodyWithCredential,
  response: {
    201: serverSchema,
    400: errorResponseSchema,
    ...serverErrorResponses,
    409: errorResponseSchema,
    422: errorResponseSchema.describe('The server could not be reached, or it rejected the key or the password'),
  },
}

/* LIST */
export const listServersSchema: FastifySchema = {
  tags: TAGS,
  summary: 'List the servers the member can access, with their load',
  security: bearerAuth,
  params: organizationParams,
  querystring: metricsQuery,
  response: {
    200: z.array(
      serverSchema.pick({ id: true, name: true, host: true, port: true }).extend({
        isConnected: z.boolean(),
        metrics: serverMetricsSchema.nullable().describe('null without a reading in the last hour'),
      }),
    ),
    ...serverErrorResponses,
  },
}

/* LIST CONNECTED */
export const listConnectedServersSchema: FastifySchema = {
  tags: TAGS,
  summary: 'List the servers with an open SSH connection right now, among the ones the member can access',
  security: bearerAuth,
  params: organizationParams,
  response: {
    200: z.array(serverSchema.pick({ id: true, name: true, host: true, port: true })),
    ...serverErrorResponses,
  },
}

/* GET */
export const getServerSchema: FastifySchema = {
  tags: TAGS,
  summary: 'Get one server, with its load',
  security: bearerAuth,
  params: serverParams,
  querystring: metricsQuery,
  response: {
    200: serverSchema.extend({
      hostFingerprint: z.string().nullable(),
      isConnected: z.boolean(),
      metrics: serverMetricsDetailsSchema.nullable().describe('null without a reading in the last hour'),
    }),
    ...serverErrorResponses,
  },
}

/* UPDATE */
// --> Every field is optional, but at least one is needed
// --> a password is only for adding a server
const updateServerBody = createServerBody
  .omit({ password: true })
  .extend({ port: z.number().int().min(1).max(65535) })
  .partial()
  .refine((body) => Object.values(body).some((value) => value !== undefined), 'Send at least one field to change')

export type UpdateServerBody = z.infer<typeof updateServerBody>

export const updateServerSchema: FastifySchema = {
  tags: TAGS,
  summary: 'Change a server, new connection settings are tested before they are saved',
  security: bearerAuth,
  params: serverParams,
  body: updateServerBody,
  response: {
    200: serverSchema.extend({ hostFingerprint: z.string().nullable() }),
    400: errorResponseSchema,
    ...serverErrorResponses,
    409: errorResponseSchema,
    422: errorResponseSchema.describe('The server could not be reached with the new settings'),
  },
}

/* DELETE */
export const deleteServerSchema: FastifySchema = {
  tags: TAGS,
  summary: 'Delete a server and close its connection',
  security: bearerAuth,
  params: serverParams,
  response: {
    204: z.null().describe('Server deleted'),
    ...serverErrorResponses,
  },
}

/* TEST CONNECTION */
export const testServerConnectionSchema: FastifySchema = {
  tags: TAGS,
  summary: 'Check that the server still answers',
  security: bearerAuth,
  params: serverParams,
  response: {
    200: z.object({
      isConnected: z.literal(true),
      latencyMs: z.number().int(),
    }),
    ...serverErrorResponses,
    422: errorResponseSchema.describe('The server could not be reached, or it rejected the key'),
  },
}
