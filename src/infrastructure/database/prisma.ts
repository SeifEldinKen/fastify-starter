import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../generated/prisma/client.js'
import { getEnv } from '../../shared/config/env-manager.js'
import Logger from '../../shared/logger.js'

const logger = new Logger('Database')

// --> Creating the client does not connect, the pool opens on the first query
export const prismaDb = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: getEnv('DATABASE_URL'),
    connectionTimeoutMillis: 5_000,
  }),
  // --> No 'error' level: failed queries already throw, logging them here would print every error twice
  log: [
    {
      level: 'warn',
      emit: 'event',
    },
  ],
})

// --> Route Prisma warnings through the app logger instead of stdout
prismaDb.$on('warn', (event) => logger.warn(event.message))

// --> Called at startup so a wrong URL or a stopped database fails immediately, not on the first request
export async function checkDatabaseConnection(): Promise<void> {
  await prismaDb.$queryRaw`SELECT 1`
  logger.info('🔌 Database connected')
}
