import type { FastifySchema } from 'fastify'
import { z } from 'zod'
import { bearerAuth, errorResponseSchema } from '../shared.schemas.js'

const TAGS = ['Organizations']

const organizationSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  role: z.object({
    key: z.string(),
    name: z.string(),
  }),
})

/* CREATE */
const createOrganizationBody = z.object({
  name: z.string().trim().min(2).max(100),
})

export type CreateOrganizationBody = z.infer<typeof createOrganizationBody>

export const createOrganizationSchema: FastifySchema = {
  tags: TAGS,
  summary: 'Create an organization, the creator becomes its owner',
  security: bearerAuth,
  body: createOrganizationBody,
  response: {
    201: organizationSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
  },
}

/* LIST MINE */
export const listMyOrganizationsSchema: FastifySchema = {
  tags: TAGS,
  summary: 'List the organizations of the logged in user',
  security: bearerAuth,
  response: {
    200: z.array(
      z.object({
        status: z.enum(['ACTIVE', 'SUSPENDED']),
        organization: organizationSchema.omit({ role: true }),
        role: organizationSchema.shape.role,
      }),
    ),
    401: errorResponseSchema,
  },
}
