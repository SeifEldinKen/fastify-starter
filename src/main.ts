import HttpServer from './http-server.js'
import { closeRedis, initRedis } from './infrastructure/redis/redis.js'
import { getAllControllers } from './presentation/controllers/index.js'
import { getEnv } from './shared/config/env-manager.js'
import Logger from './shared/logger.js'
import { SocketServer } from './socket-server.js'

const logger = new Logger('App')

const main = async (): Promise<void> => {
  logger.info(`⚙️ Environment: ${getEnv('NODE_ENV')}`)
  logger.info(`🆔 Worker PID: ${process.pid}`)

  /* Initialize Redis (RedisClient logs the connection) */
  await initRedis(getEnv('REDIS_URL'))

  /* Create instance of Server */
  const httpServer = new HttpServer({
    port: getEnv('HTTP_PORT'),
    routes: getAllControllers(),
    prefix: '/api/v1',
    onError: (error) => {
      logger.error('Server error', error)
    },
  })

  /* Create instance of SocketServer */
  // --> Bind gateways before start() so emits never hit an unbound namespace
  new SocketServer(httpServer.getServer(), [
    /* Add gateways */
  ])

  /* Start server */
  await httpServer.start().then(() => {
    const baseUrl = `http://localhost:${getEnv('HTTP_PORT')}`

    logger.info('🎉 Application started successfully!')
    logger.info(`🔥 HTTP Server running on: ${baseUrl}/healthz`)
    logger.info(`📚 Docs available at: ${baseUrl}/docs`)
  })

  let isShuttingDown = false

  // --> Graceful shutdown: finish in-flight requests before exiting
  const shutdown = async (signal: NodeJS.Signals) => {
    logger.info(`🛑 Process ${process.pid} received ${signal}`)

    if (isShuttingDown) {
      logger.warn('⚠️ Shutdown already in progress, ignoring duplicate signal')
      return
    }

    isShuttingDown = true

    logger.info('🔄 Starting graceful shutdown...')

    /* Close server */
    await httpServer.stop()

    /* Close Redis */
    await closeRedis()

    logger.info('📦 Database disconnected')

    logger.info('😴 Server shutdown completed gracefully')
    process.exit(0)
  }

  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

main().catch((error) => {
  logger.fatal(
    `💥 Failed to start application: ${error instanceof Error ? error.message : String(error)}`,
    error,
  )
  process.exit(1)
})
