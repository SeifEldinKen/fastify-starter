import type { FastifySchema } from 'fastify'
import { z } from 'zod'
import { MAX_LOG_LINES } from '@/domain/use-cases/services/get-service-logs.usecase.js'
import { SERVICE_NAME_PATTERN, SERVICE_STARTUPS, SERVICE_STATUSES } from '@/domain/use-cases/services/service.rules.js'
import { bearerAuth, errorResponseSchema, sudoPasswordHeaders } from '../shared.schemas.js'

const TAGS = ['Services']

const serverParams = z.object({
  organizationId: z.uuid(),
  serverId: z.uuid(),
})

export type ServerParams = z.infer<typeof serverParams>

const serviceSchema = z.object({
  name: z.string().describe('Without ".service"'),
  description: z.string().nullable().describe('null when the service is not loaded'),
  status: z
    .enum(SERVICE_STATUSES)
    .describe('"exited" is a service that did its job and ended well, it is not a failure'),
  subState: z.string().describe('The raw state of systemd: running, exited, dead, failed, auto-restart ...'),
  startup: z
    .enum(SERVICE_STARTUPS)
    .nullable()
    .describe('How it starts at boot: "static" is started by another service, "masked" cannot be started at all'),
})

/* LIST */
const listServicesQuery = z.object({
  status: z.enum(SERVICE_STATUSES).optional(),
})

export type ListServicesQuery = z.infer<typeof listServicesQuery>

export const listServicesSchema: FastifySchema = {
  tags: TAGS,
  summary: 'List the systemd services of a server',
  security: bearerAuth,
  params: serverParams,
  querystring: listServicesQuery,
  response: {
    200: z.object({
      summary: z
        .object({
          total: z.number().int(),
          running: z.number().int(),
          failed: z.number().int(),
        })
        .describe('Counts every service, whatever the status filter is'),
      services: z.array(serviceSchema),
    }),
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
    422: errorResponseSchema.describe('The server could not be reached, or it does not use systemd'),
  },
}

/* GET */
const serviceParams = serverParams.extend({
  // --> Goes into a command on the server, so only the characters of a service name are accepted
  name: z.string().regex(SERVICE_NAME_PATTERN, 'Not a valid service name').describe('Without ".service"'),
})

export type ServiceParams = z.infer<typeof serviceParams>

const serviceDetailsSchema = serviceSchema.extend({
  process: z
    .object({
      pid: z.number().int(),
      startedAt: z.iso.datetime().nullable(),
      memoryBytes: z.number().int().nullable(),
      cpuSeconds: z.number().nullable(),
      tasks: z.number().int().nullable(),
    })
    .nullable()
    .describe(
      'null when the service is not running. Memory, CPU and tasks are null when the server does not measure them',
    ),
  restarts: z.number().int().nullable().describe('How many times systemd started it again by itself'),
  lastExit: z
    .object({
      result: z.string().describe('success, exit-code, signal, timeout, oom-kill, core-dump ...'),
      exitCode: z.number().int().nullable(),
      at: z.iso.datetime(),
    })
    .nullable()
    .describe('How its process ended the last time, null when it never ended'),
  config: z.object({
    unitFile: z.string().nullable(),
    command: z.string().nullable(),
    user: z.string(),
    workingDirectory: z.string().nullable(),
    restartPolicy: z.string().nullable().describe('no, on-failure, always ...'),
  }),
})

export const getServiceSchema: FastifySchema = {
  tags: TAGS,
  summary: 'Get the details of one systemd service',
  security: bearerAuth,
  params: serviceParams,
  response: {
    200: serviceDetailsSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
    422: errorResponseSchema.describe('The server could not be reached, or it does not use systemd'),
  },
}

/* LOGS */
const serviceLogsQuery = z.object({
  // --> Query values are always text
  lines: z.coerce.number().int().min(1).max(MAX_LOG_LINES).default(50),
})

export type ServiceLogsQuery = z.infer<typeof serviceLogsQuery>

export const getServiceLogsSchema: FastifySchema = {
  tags: TAGS,
  summary: 'Read the last log lines of one systemd service',
  security: bearerAuth,
  params: serviceParams,
  headers: sudoPasswordHeaders,
  querystring: serviceLogsQuery,
  response: {
    200: z.object({
      name: z.string(),
      logs: z.array(z.object({ at: z.iso.datetime(), message: z.string() })).describe('The oldest line first'),
    }),
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
    422: errorResponseSchema.describe('The server could not be reached, or the service account cannot read the logs'),
  },
}
