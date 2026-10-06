import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { ZodError, z } from 'zod'
import BaseError from '../shared/errors/base.error.js'
import Logger from '../shared/logger.js'

const logger = new Logger('HTTP')

export default class GlobalErrorHandler {
  public register(app: FastifyInstance): void {
    app.setNotFoundHandler((request, reply) => this.handleNotFound(request, reply))

    app.setErrorHandler((error: FastifyError, request, reply) => this.handleError(error, request, reply))
  }

  /* NOT FOUND */
  protected handleNotFound(request: FastifyRequest, reply: FastifyReply): FastifyReply {
    return this.send(request, reply, 404, 'NOT_FOUND', 'Not Found')
  }

  /* ERRORS */
  // --> Dispatches every thrown error to the matching handler
  protected handleError(error: FastifyError, request: FastifyRequest, reply: FastifyReply): FastifyReply {
    // --> Errors thrown on purpose by the app (5xx ones fall through, so they are logged and their message hidden)
    if (error instanceof BaseError && error.statusCode < 500) {
      return this.send(request, reply, error.statusCode, error.code, error.message)
    }

    // --> Zod schema parsed directly in a handler
    if (error instanceof ZodError) {
      return this.send(request, reply, 400, 'VALIDATION_ERROR', z.prettifyError(error))
    }

    // --> Fastify route schema validation failed
    if (error.validation) {
      return this.send(request, reply, 400, 'VALIDATION_ERROR', error.message)
    }

    const statusCode = error.statusCode ?? 500

    if (statusCode >= 500) {
      return this.handleServerError(error, statusCode, request, reply)
    }

    return this.handleClientError(error, statusCode, request, reply)
  }

  // --> 5xx: log the real error, never leak its message to the client
  protected handleServerError(
    error: FastifyError,
    statusCode: number,
    request: FastifyRequest,
    reply: FastifyReply,
  ): FastifyReply {
    logger.error('Request failed', error, { method: request.method, url: request.url })
    return this.send(request, reply, statusCode, 'INTERNAL_ERROR', 'Internal Server Error')
  }

  // --> 4xx raised by Fastify itself (e.g. malformed JSON body): the message is safe to send to the client
  protected handleClientError(
    error: FastifyError,
    statusCode: number,
    request: FastifyRequest,
    reply: FastifyReply,
  ): FastifyReply {
    return this.send(request, reply, statusCode, error.code ?? 'REQUEST_ERROR', error.message)
  }

  // --> Single response shape for every error
  private send(
    request: FastifyRequest,
    reply: FastifyReply,
    statusCode: number,
    code: string,
    message: string,
  ): FastifyReply {
    return reply.code(statusCode).send({
      success: false,
      statusCode,
      code,
      message,
      path: request.url,
    })
  }
}
