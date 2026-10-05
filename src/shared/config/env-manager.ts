import dotenv from 'dotenv'
import { z } from 'zod'

// --> In production env variables come from the platform, not from a .env file
const nodeEnv = process.env.NODE_ENV ?? 'development'

if (nodeEnv !== 'production') {
  // --> .env.<NODE_ENV> first, then .env as shared fallback (first value wins)
  // missing files are ignored, existing variables are not overridden
  dotenv.config({
    path: [`.env.${nodeEnv}`, '.env'],
    quiet: true,
  })
}

const envSchema = z.object({
  /* APP */
  NODE_ENV: z.enum(['development', 'stage', 'production']).default('development'),

  /* HTTP */
  HTTP_PORT: z.coerce.number().int().min(1).max(65535).default(4618),

  /* DATABASE */

  /* REDIS */
  REDIS_URL: z.url({ protocol: /^rediss?$/ }).default('redis://localhost:6379'),
})

export type Env = Readonly<z.infer<typeof envSchema>>

const loadEnv = (): Env => {
  const result = envSchema.safeParse(process.env)

  // --> Check if env variables are valid
  if (result.success === false) {
    // TODO: log
    console.error(`Invalid environment variables:\n${z.prettifyError(result.error)}`)

    process.exit(1)
  }

  return Object.freeze(result.data)
}

export const env = loadEnv()

// --> Typed access to a single env variable
export const getEnv = <K extends keyof Env>(key: K): Env[K] => {
  return env[key]
}
