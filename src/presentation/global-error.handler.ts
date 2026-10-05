import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { ZodError } from 'zod'
import Logger from '../shared/logger.js'

const logger = new Logger('HTTP')

export default class GlobalErrorHandler {
  constructor() {}

  public register(app: FastifyInstance): void {
    app.setNotFoundHandler((request, reply) => this.handleNotFound(request, reply))

    app.setErrorHandler((error: FastifyError, request, reply) =>
      this.handleError(error, request, reply),
    )
  }

  /* NOT FOUND */
  protected handleNotFound(request: FastifyRequest, reply: FastifyReply): FastifyReply {
    return reply.code(404).send({ error: 'Not Found', path: request.url })
  }

  /* ERRORS */
  // --> Dispatches every thrown error to the matching handler
  protected handleError(
    error: FastifyError,
    request: FastifyRequest,
    reply: FastifyReply,
  ): FastifyReply {
    if (error.validation) {
    }

    // --> check if the error is a ZodError (validation error)
    if (error instanceof ZodError) {
      return reply.code(400).send({
        success: false,
        statusCode: 400,
        name: error.name,
        message: error.message,
        path: request.url,
      })
    }

    const statusCode = error.statusCode ?? 500

    if (statusCode >= 500) {
      return this.handleServerError(error, statusCode, request, reply)
    }

    return this.handleClientError(error, statusCode, reply)
  }

  // --> 400: schema validation failed
  protected handleValidationError(error: FastifyError, reply: FastifyReply): FastifyReply {
    return reply.code(400).send({
      success: false,
      statusCode: 400,
      name: error.name,
      message: error.message,
      // path: ,
    })
  }

  // --> 5xx: log the real error, never leak its message to the client
  protected handleServerError(
    error: FastifyError,
    statusCode: number,
    request: FastifyRequest,
    reply: FastifyReply,
  ): FastifyReply {
    logger.error('Request failed', error, { method: request.method, url: request.url })
    return reply.code(statusCode).send({ error: 'Internal Server Error' })
  }

  // --> 4xx: the message is safe to send to the client
  protected handleClientError(
    error: FastifyError,
    statusCode: number,
    reply: FastifyReply,
  ): FastifyReply {
    return reply.code(statusCode).send({ error: error.message })
  }
}
