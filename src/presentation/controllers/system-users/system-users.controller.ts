import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import CreateSystemUserUseCase from '@/domain/use-cases/system-users/create-system-user.usecase.js'
import GetSystemUserUseCase from '@/domain/use-cases/system-users/get-system-user.usecase.js'
import ListSystemUsersUseCase from '@/domain/use-cases/system-users/list-system-users.usecase.js'
import EnsureAuthenticateHook from '../../hooks/ensure-authenticate.hook.js'
import EnsurePermissionHook from '../../hooks/ensure-permission.hook.js'
import BaseController from '../base.controller.js'
import type { SudoPasswordHeaders } from '../shared.schemas.js'
import {
  type CreateSystemUserBody,
  createSystemUserSchema,
  getSystemUserSchema,
  type ListSystemUsersQuery,
  listSystemUsersSchema,
  type ServerParams,
  type SystemUserParams,
} from './system-users.schemas.js'

export default class SystemUsersController extends BaseController {
  protected readonly prefix = '/organizations/:organizationId/servers/:serverId/system-users'

  constructor(
    private readonly listSystemUsersUseCase: ListSystemUsersUseCase = new ListSystemUsersUseCase(),
    private readonly getSystemUserUseCase: GetSystemUserUseCase = new GetSystemUserUseCase(),
    private readonly createSystemUserUseCase: CreateSystemUserUseCase = new CreateSystemUserUseCase(),
  ) {
    super()
  }

  protected registerRoutes(app: FastifyInstance): void {
    /* GET */
    app.get<{ Params: ServerParams; Querystring: ListSystemUsersQuery }>('/', {
      schema: listSystemUsersSchema,
      handler: this.list.bind(this),
      onRequest: [
        /* Middlewares */
        new EnsureAuthenticateHook().handler(),
        new EnsurePermissionHook().require({ organization: ['system-user:view'] }),
      ],
    })

    app.get<{ Params: SystemUserParams; Headers: SudoPasswordHeaders }>('/:username', {
      schema: getSystemUserSchema,
      handler: this.get.bind(this),
      onRequest: [
        /* Middlewares */
        new EnsureAuthenticateHook().handler(),
        new EnsurePermissionHook().require({ organization: ['system-user:view'] }),
      ],
    })

    /* POST */
    app.post<{ Params: ServerParams; Body: CreateSystemUserBody; Headers: SudoPasswordHeaders }>('/', {
      schema: createSystemUserSchema,
      handler: this.create.bind(this),
      onRequest: [
        /* Middlewares */
        new EnsureAuthenticateHook().handler(),
        new EnsurePermissionHook().require({ organization: ['system-user:manage'] }),
      ],
    })
  }

  private async list(
    request: FastifyRequest<{ Params: ServerParams; Querystring: ListSystemUsersQuery }>,
    reply: FastifyReply,
  ) {
    const result = await this.listSystemUsersUseCase.execute({
      serverId: request.params.serverId,
      includeSystem: request.query.includeSystem === 'true',
    })

    return this.ok(reply, result)
  }

  private async get(
    request: FastifyRequest<{ Params: SystemUserParams; Headers: SudoPasswordHeaders }>,
    reply: FastifyReply,
  ) {
    const user = await this.getSystemUserUseCase.execute({
      serverId: request.params.serverId,
      username: request.params.username,
      sudoPassword: request.headers['x-sudo-password'],
    })

    return this.ok(reply, user)
  }

  private async create(
    request: FastifyRequest<{ Params: ServerParams; Body: CreateSystemUserBody; Headers: SudoPasswordHeaders }>,
    reply: FastifyReply,
  ) {
    const user = await this.createSystemUserUseCase.execute({
      ...request.body,
      userId: request.user.userId,
      organizationId: request.params.organizationId,
      serverId: request.params.serverId,
      sudoPassword: request.headers['x-sudo-password'],
    })

    return this.created(reply, user)
  }
}
