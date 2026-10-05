import type { Server } from 'node:http'
import Fastify, { type FastifyInstance, type FastifyPluginAsync } from 'fastify'
import GlobalErrorHandler from './presentation/global-error.handler.js'
import Logger from './shared/logger.js'

const logger = new Logger('HTTP')

export interface RouteModule {
  plugin: FastifyPluginAsync
  prefix?: string
  globalPrefix?: string
}

export interface AppServerOptions {
  port: number
  host?: string
  logger?: boolean
  prefix?: string
  routes?: RouteModule[]
  onError?: (error: Error) => void
}

export default class HttpServer {
  private readonly app: FastifyInstance
  private isRunning = false

  constructor(private readonly options: AppServerOptions) {
    // --> Fastify's own logger stays off (request.log is a no-op), log with shared/logger instead
    this.app = Fastify({
      forceCloseConnections: 'idle',
    })

    this.registerMiddlewares()
    this.registerRoutes(options.routes ?? [])
    this.registerErrorHandlers()
  }

  private registerMiddlewares(): void {
    this.app.addHook('onRequest', async (request) => {
      logger.debug('incoming request', { method: request.method, url: request.url })
    })
  }

  private registerRoutes(routes: RouteModule[]): void {
    for (const { plugin, prefix = '', globalPrefix } of routes) {
      // --> Module override wins over the server's global prefix
      const fullPrefix = `${globalPrefix ?? this.options.prefix ?? ''}${prefix}`

      this.app.register(plugin, {
        prefix: fullPrefix,
      })
    }
  }

  private registerErrorHandlers(): void {
    // --> Observe every error (logging, Sentry...), runs before the error handler and can't change the reply
    const { onError } = this.options

    if (onError) {
      this.app.addHook('onError', async (_request, _reply, error) => {
        onError(error)
      })
    }

    new GlobalErrorHandler().register(this.app)
  }

  // --> Native Node server (passed to SocketServer in main.ts)
  public getServer(): Server {
    return this.app.server
  }

  // --> Fastify instance (e.g. app.inject() in tests)
  public getApp(): FastifyInstance {
    return this.app
  }

  public async start(): Promise<void> {
    if (this.isRunning) {
      return
    }

    await this.app.listen({
      port: this.options.port,
      host: this.options.host ?? '0.0.0.0',
    })

    this.isRunning = true
  }

  // --> Stops accepting new connections and waits for in-flight requests to finish
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      return
    }

    await this.app.close()
    this.isRunning = false
  }
}
