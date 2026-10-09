import { randomUUID, timingSafeEqual } from 'node:crypto'
import type { Server } from 'node:http'
import fastifySwagger from '@fastify/swagger'
import scalarApiReference from '@scalar/fastify-api-reference'
import Fastify, { type FastifyError, type FastifyInstance, type FastifyPluginAsync } from 'fastify'
import { jsonSchemaTransform, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import { httpRequestDuration, metricsRegistry } from './infrastructure/metrics/metrics.js'
import GlobalErrorHandler from './presentation/global-error.handler.js'
import { getEnv } from './shared/config/env-manager.js'
import NotFoundError from './shared/errors/not-found.error.js'
import UnauthorizedError from './shared/errors/unauthorized.error.js'
import Logger from './shared/logger.js'

const logger = new Logger('HTTP')

// --> Not logged: scraped or loaded automatically, they would bury the real requests
const UNLOGGED_PATHS = ['/metrics', '/healthz', '/favicon.ico']
const UNLOGGED_PREFIX = '/docs'

export interface RouteModule {
  plugin: FastifyPluginAsync
  prefix?: string
  // --> Replaces the server's global prefix for this controller only
  globalPrefix?: string
}

export interface AppServerOptions {
  port: number
  host?: string
  logger?: boolean
  // --> Global prefix added in front of every controller prefix
  prefix?: {
    path: string
    // --> Controller prefixes registered without the global prefix (e.g. '/healthz')
    exclude?: string[]
  }
  routes: RouteModule[]
  docs?: {
    title: string
    version: string
  }
  metrics?: { token: string }
}

export default class HttpServer {
  private readonly app: FastifyInstance
  private isRunning = false

  constructor(private readonly options: AppServerOptions) {
    // --> Fastify's own logger stays off (request.log is a no-op), log with shared/logger instead
    this.app = Fastify({
      forceCloseConnections: 'idle',
      // --> Short id of the request, printed in its log line and returned in error responses
      genReqId: () => randomUUID().slice(0, 8),
    })

    this.registerSchemas()

    this.registerMiddlewares()

    this.registerMetrics()

    /* Register routes */
    this.registerRoutes(options.routes)

    this.registerErrorHandlers()
  }

  // --> Must run before the routes are registered: swagger only sees routes added after it
  private registerSchemas(): void {
    // --> zod schemas of the routes validate the request and shape the response
    this.app.setValidatorCompiler(validatorCompiler)
    this.app.setSerializerCompiler(serializerCompiler)

    const { docs } = this.options

    if (!docs) {
      return
    }

    // --> Builds the OpenAPI document from the same zod schemas
    this.app.register(fastifySwagger, {
      openapi: {
        info: docs,
        components: {
          securitySchemes: {
            bearerAuth: {
              type: 'http',
              scheme: 'bearer',
              bearerFormat: 'JWT',
            },
          },
        },
      },
      transform: jsonSchemaTransform,
    })

    // --> Scalar UI on top of that document
    this.app.register(scalarApiReference, {
      routePrefix: '/docs',
    })
  }

  private registerMiddlewares(): void {
    const isProduction = getEnv('NODE_ENV') === 'production'

    // --> one line per finished request: GET /api/v1/auth/me 200 9ms ip=127.0.0.1 user=<id> req=<id>
    this.app.addHook('onResponse', async (request, reply) => {
      // --> without the query string, it can carry tokens
      const path = request.url.split('?')[0] ?? request.url

      if (UNLOGGED_PATHS.includes(path) || path.startsWith(UNLOGGED_PREFIX)) {
        return
      }

      const status = reply.statusCode
      const durationMs = Math.round(reply.elapsedTime)
      // --> set by EnsureAuthenticateHook, missing on public routes and rejected requests
      const userId = request.user?.userId

      const message = [
        `${request.method} ${path} ${status} ${durationMs}ms`,
        `ip=${request.ip}`,
        ...(userId ? [`user=${userId}`] : []),
        `req=${request.id}`,
      ].join(' ')

      // --> production logs are JSON: the same values as separate fields, so log tools can filter by them
      const data = isProduction
        ? { method: request.method, path, status, durationMs, ip: request.ip, userId, requestId: request.id }
        : undefined

      if (status >= 500) {
        logger.error(message, undefined, data)
      } else if (status >= 400) {
        logger.warn(message, data)
      } else {
        logger.info(message, data)
      }
    })
  }

  private registerMetrics(): void {
    const { metrics } = this.options

    if (!metrics) {
      return
    }

    const expected = Buffer.from(`Bearer ${metrics.token}`)

    // --> record every finished request
    this.app.addHook('onResponse', async (request, reply) => {
      // --> the route pattern ('/servers/:serverId'), unknown urls share one label so they cannot flood Prometheus
      const route = request.routeOptions.url ?? 'not_found'

      if (route === '/metrics') {
        return
      }

      httpRequestDuration.observe({ method: request.method, route, status: reply.statusCode }, reply.elapsedTime / 1000)
    })

    // --> scraped by Prometheus, hidden from the API reference
    this.app.get('/metrics', { schema: { hide: true } }, async (request, reply) => {
      const actual = Buffer.from(request.headers.authorization ?? '')

      // --> timingSafeEqual throws on different lengths
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        throw new UnauthorizedError()
      }

      return reply.type(metricsRegistry.contentType).send(await metricsRegistry.metrics())
    })
  }

  private registerRoutes(routes: RouteModule[]): void {
    const { path = '', exclude = [] } = this.options.prefix ?? {}

    // --> a typo in the list would silently keep the prefix, fail at startup instead
    const unknown = exclude.filter((item) => !routes.some((route) => route.prefix === item))

    if (unknown.length > 0) {
      throw new Error(`prefix.exclude has no matching controller: ${unknown.join(', ')}`)
    }

    for (const { plugin, prefix = '', globalPrefix } of routes) {
      // --> the controller's own globalPrefix wins, then the exclude list, then the server's global prefix
      const basePrefix = globalPrefix ?? (exclude.includes(prefix) ? '' : path)
      const fullPrefix = `${basePrefix}${prefix}`

      this.app.register(plugin, {
        prefix: fullPrefix,
      })
    }
  }

  private registerErrorHandlers(): void {
    this.app.setNotFoundHandler(() => {
      throw new NotFoundError('Oops! You seem to be lost. This route does not exist 🧭')
    })

    this.app.setErrorHandler((error: FastifyError, request, reply) =>
      new GlobalErrorHandler().handleError(error, request, reply),
    )
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
