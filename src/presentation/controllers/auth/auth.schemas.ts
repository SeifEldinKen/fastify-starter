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

/* LOGIN */
const loginBody = z.object({
  email: z.email().max(254).default('seifeldinrefaat@gmail.com'),
  password: z.string().min(1).max(128).default('seaways22'),
})

export type LoginBody = z.infer<typeof loginBody>

export const loginSchema: FastifySchema = {
  tags: TAGS,
  summary: 'Log in and open a session',
  body: loginBody,
  response: {
    200: z.object({
      accessToken: z.string(),
      refreshToken: z.string(),
      user: userSchema,
    }),
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
  },
}

/* FORGOT PASSWORD */
const forgotPasswordBody = z.object({
  email: z.email().max(254),
})

export type ForgotPasswordBody = z.infer<typeof forgotPasswordBody>

export const forgotPasswordSchema: FastifySchema = {
  tags: TAGS,
  summary: 'Request a password reset code',
  body: forgotPasswordBody,
  response: {
    200: z.object({ message: z.string() }).describe('Same answer whether the email is registered or not'),
    400: errorResponseSchema,
    429: errorResponseSchema,
  },
}

/* VERIFY RESET OTP */
const verifyResetOtpBody = z.object({
  email: z.email().max(254),
  otp: z.string().regex(/^\d{6}$/, 'Must be 6 digits'),
})

export type VerifyResetOtpBody = z.infer<typeof verifyResetOtpBody>

export const verifyResetOtpSchema: FastifySchema = {
  tags: TAGS,
  summary: 'Exchange a password reset code for a reset token',
  body: verifyResetOtpBody,
  response: {
    200: z.object({ resetToken: z.string() }),
    400: errorResponseSchema,
    429: errorResponseSchema,
  },
}

/* LOGOUT */
export const logoutSchema: FastifySchema = {
  tags: TAGS,
  summary: 'End the current session',
  security: bearerAuth,
  response: {
    204: z.null().describe('Session ended'),
    401: errorResponseSchema,
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
