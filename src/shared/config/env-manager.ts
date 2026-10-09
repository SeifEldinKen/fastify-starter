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

  /* METRICS */
  // --> Sent by Prometheus on every scrape, /metrics is not served at all when it is missing
  METRICS_TOKEN: z.string().min(32).optional(),

  /* DATABASE */
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),

  /* REDIS */
  REDIS_URL: z.url({ protocol: /^rediss?$/ }).default('redis://localhost:6379'),

  /* AUTH */
  // --> Two different secrets, so a refresh token can never be verified as an access token
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  // --> In seconds: 15 minutes and 30 days
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),

  // --> bcrypt cost: each +1 doubles the hashing time (12 ≈ 250ms), safe to change, old hashes keep working
  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
  // --> Never change or lose it: every stored password becomes unverifiable
  PASSWORD_PEPPER: z.string().min(32),

  /* ENCRYPTION */
  // --> 32 random bytes in base64, encrypts the servers' SSH keys
  // never lose it: every stored key becomes unreadable
  ENCRYPTION_KEY: z.string().refine((value) => Buffer.from(value, 'base64').length === 32, {
    error: 'Must be 32 bytes encoded as base64',
  }),
})

export type Env = Readonly<z.infer<typeof envSchema>>

const loadEnv = (): Env => {
  const result = envSchema.safeParse(process.env)

  // --> Check if env variables are valid
  if (result.success === false) {
    // --> console, not logger: the logger reads NODE_ENV from here, so it can't exist before env is valid
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
