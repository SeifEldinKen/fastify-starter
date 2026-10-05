import HttpServer from './http-server.js'
import { getAllControllers } from './presentation/controllres/index.js'
import { getEnv } from './shared/config/env-manager.js'
import { SocketServer } from './socket-server.js'

const main = async (): Promise<void> => {
  /* Create instance of Server */
  const httpServer = new HttpServer({
    port: getEnv('HTTP_PORT'),
    routes: getAllControllers(),
    prefix: '/api/v1',
  })

  /* Start server */
  await httpServer.start().then(() => {
    console.log(`Server started on port ${getEnv('HTTP_PORT')}`)
  })

  /* Create instance of SocketServer */
  const socketServer = new SocketServer(httpServer.getServer(), [
    /* Add gateways */
  ])

  // --> Graceful shutdown: finish in-flight requests before exiting
  const shutdown = async (signal: NodeJS.Signals) => {
    console.log(`${signal} received, shutting down...`)

    await httpServer.stop()
    process.exit(0)
  }

  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

main().catch((err) => {
  // TODO: log
  console.error('Failed to start the server:', err)
  process.exit(1)
})
