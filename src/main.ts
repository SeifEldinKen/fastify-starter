import closeWithGrace from 'close-with-grace'
import HttpServer from '@/http-server'
import { checkDatabaseConnection, prismaDb } from '@/infrastructure/database/prisma'
import { closeRedis, initRedis } from '@/infrastructure/redis/redis'
import { getAllControllers } from '@/presentation/controllers'
import OrganizationsGateway from '@/presentation/socket-gateway/organizations.gateway'
import { getEnv } from '@/shared/config/env-manager'
import Logger from '@/shared/logger'
import { SocketServer } from '@/socket-server'

const SHUTDOWN_TIMEOUT_MS = 10_000

const logger = new Logger('App')

const bootstrap = async (): Promise<void> => {
  logger.info(`⚙️ Environment: ${getEnv('NODE_ENV')}`)
  logger.info(`🆔 Worker PID: ${process.pid}`)

  /* Check database connection */
  await checkDatabaseConnection()

  /* Initialize Redis (shared client + subscriber) */
  await initRedis(getEnv('REDIS_URL'))

  const metricsToken = getEnv('METRICS_TOKEN')

  /* Create instance of Server */
  const httpServer = new HttpServer({
    host: '0.0.0.0',
    port: getEnv('HTTP_PORT'),
    routes: getAllControllers(),
    prefix: {
      path: '/api/v1',
      exclude: [
        /* Registered without the global prefix */
        '/healthz',
      ],
    },
    ...(getEnv('NODE_ENV') !== 'production' && {
      docs: {
        title: 'Server Panel API',
        version: '1.0.0',
      },
    }),
    ...(metricsToken && {
      metrics: {
        token: metricsToken,
      },
    }),
  })

  /* Create instance of SocketServer */
  const socketServer = new SocketServer(httpServer.getServer(), {
    gateways: [
      /* Add gateways */
      new OrganizationsGateway(),
    ],
  })

  /* Start server */
  await httpServer.start().then(() => {
    const baseUrl = `http://localhost:${getEnv('HTTP_PORT')}`

    logger.info('🎉 Application started successfully!')
    logger.info(`🔥 HTTP Server running on: ${baseUrl}/healthz`)
    logger.info(`📚 Docs available at: ${baseUrl}/docs`)
  })

  // --> Graceful shutdown on SIGINT, SIGTERM, uncaught exception and unhandled rejection
  closeWithGrace({ delay: SHUTDOWN_TIMEOUT_MS, logger: false }, async ({ signal, err }) => {
    if (err) {
      logger.error(`💥 Uncaught error: ${err.message}`, err)
    }

    logger.info(`🔄 Starting graceful shutdown... ${signal ?? ''}`)

    /* Disconnect sockets: open WebSockets would block the HTTP close until the timeout */
    await socketServer.disconnectAll()
    logger.info('🔌 Sockets disconnected')

    /* Close HTTP server */
    await httpServer.stop()

    /* Close Socket.IO: unsubscribes the adapter, so Redis must still be up */
    await socketServer.close()

    /* Close Redis (nothing uses it anymore) */
    await closeRedis()
    logger.info('📦 Redis disconnected')

    /* Disconnect from database */
    await prismaDb.$disconnect()
    logger.info('📦 Database disconnected')

    logger.info('😴 Server shutdown completed gracefully')
  })
}

bootstrap().catch((error) => {
  logger.fatal(`💥 Failed to start application: ${error instanceof Error ? error.message : String(error)}`, error)
  process.exit(1)
})
