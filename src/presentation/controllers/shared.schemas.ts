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

// --> Routes that run something as root on a server add this to their schema
// the password is only sent by a client that got SUDO_PASSWORD_REQUIRED: it lives until the request ends, never saved
// looseObject: every other header of the request is kept as it is
export const sudoPasswordHeaders = z.looseObject({
  'x-sudo-password': z
    .string()
    .min(1)
    .max(256)
    .optional()
    .describe('Sudo password of the account used on the server, send it after a SUDO_PASSWORD_REQUIRED error'),
})

export type SudoPasswordHeaders = z.infer<typeof sudoPasswordHeaders>
