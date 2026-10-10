import type { FastifySchema } from 'fastify'
import { z } from 'zod'
import { bearerAuth, errorResponseSchema } from '../shared.schemas.js'

const TAGS = ['Auth']

const userSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  firstName: z.string(),
  lastName: z.string(),
})

/* REGISTER */
const registerBody = z.object({
  email: z.email().max(254),
  firstName: z.string().trim().min(1).max(50),
  lastName: z.string().trim().min(1).max(50),
  password: z.string().min(8).max(128),
})

export type RegisterBody = z.infer<typeof registerBody>

export const registerSchema: FastifySchema = {
  tags: TAGS,
  summary: 'Create an account',
  body: registerBody,
  response: {
    201: userSchema,
    400: errorResponseSchema,
    409: errorResponseSchema,
  },
}

/* CURRENT USER */
export const currentUserSchema: FastifySchema = {
  tags: TAGS,
  summary: 'Get the logged in user',
  security: bearerAuth,
  response: {
    200: userSchema.extend({ isEmailVerified: z.boolean() }),
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
  },
}
