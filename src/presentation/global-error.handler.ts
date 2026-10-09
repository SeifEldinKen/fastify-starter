import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify'
import { ZodError, z } from 'zod'
import BaseError from '../shared/errors/base.error.js'
import Logger from '../shared/logger.js'

const logger = new Logger('HTTP')

interface SendErrorRequest {
  request: FastifyRequest
  reply: FastifyReply
  statusCode: number
  code: string
  message: string
}

export default class GlobalErrorHandler {
  /* ERRORS */
  // --> Passed to app.setErrorHandler, dispatches every thrown error to the matching handler
  public handleError(error: FastifyError, request: FastifyRequest, reply: FastifyReply): FastifyReply {
    // --> Errors thrown on purpose by the app (5xx ones fall through, so they are logged and their message hidden)
    if (error instanceof BaseError && error.statusCode < 500) {
      return this.send({
        request,
        reply,
        statusCode: error.statusCode,
        code: error.code,
        message: error.message,
      })
    }

    // --> Zod schema parsed directly in a handler
    if (error instanceof ZodError) {
      return this.send({ request, reply, statusCode: 400, code: 'VALIDATION_ERROR', message: z.prettifyError(error) })
    }

    // --> Fastify route schema validation failed
    if (error.validation) {
      return this.send({ request, reply, statusCode: 400, code: 'VALIDATION_ERROR', message: error.message })
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
    return this.send({ request, reply, statusCode, code: 'INTERNAL_ERROR', message: 'Internal Server Error' })
  }

  // --> 4xx raised by Fastify itself (e.g. malformed JSON body): the message is safe to send to the client
  protected handleClientError(
    error: FastifyError,
    statusCode: number,
    request: FastifyRequest,
    reply: FastifyReply,
  ): FastifyReply {
    return this.send({
      request,
      reply,
      statusCode,
      code: error.code ?? 'REQUEST_ERROR',
      message: error.message,
    })
  }

  // --> Single response shape for every error
  private send({ request, reply, statusCode, code, message }: SendErrorRequest): FastifyReply {
    return reply.code(statusCode).send({
      success: false,
      statusCode,
      code,
      message,
      path: request.url,
      requestId: request.id,
    })
  }
}
