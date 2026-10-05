import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from 'fastify'
import { z } from 'zod'
import type { RouteModule } from '../../http-server.js'

export default abstract class BaseController {
  // --> URL prefix shared by all routes of the controller (e.g. '/users')
  protected abstract readonly prefix: string

  // --> Override the server's global prefix for this controller only
  // undefined = use the global prefix, '' = no global prefix, '/internal' = replace it
  protected readonly globalPrefix?: string

  // --> Declare the controller's routes on the encapsulated Fastify instance
  // use arrow functions for handlers so `this` stays bound to the controller
  protected abstract registerRoutes(app: FastifyInstance): void | Promise<void>

  // --> Wraps the controller as a Fastify plugin registered under its prefix
  public toRouteModule(): RouteModule {
    const plugin: FastifyPluginAsync = async (app) => {
      await this.registerRoutes(app)
    }

    return {
      plugin,
      prefix: this.prefix,
      ...(this.globalPrefix !== undefined && {
        globalPrefix: this.globalPrefix,
      }),
    }
  }

  /* RESPONSES */
  protected ok<T>(reply: FastifyReply, data: T): FastifyReply {
    return reply.code(200).send(data)
  }

  protected created<T>(reply: FastifyReply, data: T): FastifyReply {
    return reply.code(201).send(data)
  }

  protected noContent(reply: FastifyReply): FastifyReply {
    return reply.code(204).send()
  }

  /* VALIDATION */
  // --> Parses input with a zod schema, throws a 400 error handled by HttpServer's error handler
  protected validate<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
    const result = schema.safeParse(data)

    if (result.success === false) {
      throw Object.assign(new Error(z.prettifyError(result.error)), { statusCode: 400 })
    }

    return result.data
  }
}
