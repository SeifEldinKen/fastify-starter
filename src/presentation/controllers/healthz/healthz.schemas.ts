import type { FastifySchema } from 'fastify'
import { z } from 'zod'

const serviceHealthSchema = z.object({
  status: z.enum(['up', 'down']),
  latencyMs: z.number().int().optional(),
})

const healthSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  pid: z.number().int(),
  uptimeSeconds: z.number().int(),
  timestamp: z.iso.datetime(),
  services: z.object({
    database: serviceHealthSchema,
    redis: serviceHealthSchema,
  }),
})

export const healthzSchema: FastifySchema = {
  tags: ['Health'],
  summary: 'Check that the app and the services it depends on are working',
  response: {
    200: healthSchema.describe('Everything is up'),
    503: healthSchema.describe('At least one service is down'),
  },
}
