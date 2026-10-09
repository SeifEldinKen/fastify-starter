import { z } from 'zod'

// --> Shape of every error response, sent by GlobalErrorHandler
export const errorResponseSchema = z.object({
  success: z.literal(false),
  statusCode: z.number().int(),
  code: z.string(),
  message: z.string(),
  path: z.string(),
  // --> Also printed in the log line of the request, quote it when reporting a problem
  requestId: z.string(),
})

// --> Routes behind EnsureAuthenticateHook add this to their schema
export const bearerAuth = [{ bearerAuth: [] }]
