import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import CheckHealthUseCase from '@/domain/use-cases/health/check-health.usecase.js'
import BaseController from '../base.controller.js'
import { healthzSchema } from './healthz.schemas.js'

export default class HealthzController extends BaseController {
  protected readonly prefix = '/healthz'

  constructor(private readonly checkHealthUseCase: CheckHealthUseCase = new CheckHealthUseCase()) {
    super()
  }

  protected registerRoutes(app: FastifyInstance): void {
    /* GET */
    app.get('/', {
      schema: healthzSchema,
      handler: this.healthz.bind(this),
      onRequest: [
        /* Add Middlewares here */
      ],
    })
  }

  private async healthz(_request: FastifyRequest, reply: FastifyReply) {
    const health = await this.checkHealthUseCase.execute()

    // --> 503 tells load balancers and uptime monitors to stop trusting this instance
    return reply.code(health.status === 'ok' ? 200 : 503).send(health)
  }
}
