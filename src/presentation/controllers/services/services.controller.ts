import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import GetServiceUseCase from '@/domain/use-cases/services/get-service.usecase.js'
import GetServiceLogsUseCase from '@/domain/use-cases/services/get-service-logs.usecase.js'
import ListServicesUseCase from '@/domain/use-cases/services/list-services.usecase.js'
import EnsureAuthenticateHook from '../../hooks/ensure-authenticate.hook.js'
import EnsurePermissionHook from '../../hooks/ensure-permission.hook.js'
import BaseController from '../base.controller.js'
import type { SudoPasswordHeaders } from '../shared.schemas.js'
import {
  getServiceLogsSchema,
  getServiceSchema,
  type ListServicesQuery,
  listServicesSchema,
  type ServerParams,
  type ServiceLogsQuery,
  type ServiceParams,
} from './services.schemas.js'

export default class ServicesController extends BaseController {
  protected readonly prefix = '/organizations/:organizationId/servers/:serverId/services'

  constructor(
    private readonly listServicesUseCase: ListServicesUseCase = new ListServicesUseCase(),
    private readonly getServiceUseCase: GetServiceUseCase = new GetServiceUseCase(),
    private readonly getServiceLogsUseCase: GetServiceLogsUseCase = new GetServiceLogsUseCase(),
  ) {
    super()
  }

  protected registerRoutes(app: FastifyInstance): void {
    /* GET */
    app.get<{ Params: ServerParams; Querystring: ListServicesQuery }>('/', {
      schema: listServicesSchema,
      handler: this.list.bind(this),
      onRequest: [
        /* Middlewares */
        new EnsureAuthenticateHook().handler(),
        new EnsurePermissionHook().require({ organization: ['service:view'] }),
      ],
    })

    app.get<{ Params: ServiceParams }>('/:name', {
      schema: getServiceSchema,
      handler: this.get.bind(this),
      onRequest: [
        /* Middlewares */
        new EnsureAuthenticateHook().handler(),
        new EnsurePermissionHook().require({ organization: ['service:view'] }),
      ],
    })

    app.get<{ Params: ServiceParams; Querystring: ServiceLogsQuery; Headers: SudoPasswordHeaders }>('/:name/logs', {
      schema: getServiceLogsSchema,
      handler: this.logs.bind(this),
      onRequest: [
        /* Middlewares */
        new EnsureAuthenticateHook().handler(),
        new EnsurePermissionHook().require({ organization: ['service:logs'] }),
      ],
    })
  }

  private async list(
    request: FastifyRequest<{ Params: ServerParams; Querystring: ListServicesQuery }>,
    reply: FastifyReply,
  ) {
    const result = await this.listServicesUseCase.execute({
      serverId: request.params.serverId,
      status: request.query.status,
    })

    return this.ok(reply, result)
  }

  private async get(request: FastifyRequest<{ Params: ServiceParams }>, reply: FastifyReply) {
    const service = await this.getServiceUseCase.execute({
      serverId: request.params.serverId,
      name: request.params.name,
    })

    return this.ok(reply, service)
  }

  private async logs(
    request: FastifyRequest<{ Params: ServiceParams; Querystring: ServiceLogsQuery; Headers: SudoPasswordHeaders }>,
    reply: FastifyReply,
  ) {
    const result = await this.getServiceLogsUseCase.execute({
      serverId: request.params.serverId,
      name: request.params.name,
      lines: request.query.lines,
      sudoPassword: request.headers['x-sudo-password'],
    })

    return this.ok(reply, result)
  }
}
