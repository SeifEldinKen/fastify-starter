import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import BaseController from '../base.controller.js'

export default class HealthzController extends BaseController {
  protected override readonly globalPrefix = ''
  protected readonly prefix = '/healthz'

  protected registerRoutes(app: FastifyInstance): void {
    /* GET */
    app.get('/', {
      handler: this.healthz.bind(this),
      onRequest: [
        /* Add Middlewares here */
      ],
    })
  }

  private async healthz(_request: FastifyRequest, reply: FastifyReply) {
    return this.ok(reply, {
      status: 'ok',
      uptime: process.uptime(),
    })
  }
}
