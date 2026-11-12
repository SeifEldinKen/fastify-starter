import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import CreateServerUseCase from '@/domain/use-cases/servers/create-server.usecase.js'
import DeleteServerUseCase from '@/domain/use-cases/servers/delete-server.usecase.js'
import GetServerUseCase from '@/domain/use-cases/servers/get-server.usecase.js'
import ListConnectedServersUseCase from '@/domain/use-cases/servers/list-connected-servers.usecase.js'
import ListServersUseCase from '@/domain/use-cases/servers/list-servers.usecase.js'
import TestServerConnectionUseCase from '@/domain/use-cases/servers/test-server-connection.usecase.js'
import UpdateServerUseCase from '@/domain/use-cases/servers/update-server.usecase.js'
import ForbiddenError from '@/shared/errors/forbidden.error.js'
import EnsureAuthenticateHook from '../../hooks/ensure-authenticate.hook.js'
import EnsurePermissionHook from '../../hooks/ensure-permission.hook.js'
import BaseController from '../base.controller.js'
import {
  type CreateServerBody,
  createServerSchema,
  deleteServerSchema,
  getServerSchema,
  listConnectedServersSchema,
  listServersSchema,
  type MetricsQuery,
  type OrganizationParams,
  type ServerParams,
  testServerConnectionSchema,
  type UpdateServerBody,
  updateServerSchema,
} from './servers.schemas.js'

export default class ServersController extends BaseController {
  protected readonly prefix = '/organizations/:organizationId/servers'

  constructor(
    private readonly createServerUseCase: CreateServerUseCase = new CreateServerUseCase(),
    private readonly listServersUseCase: ListServersUseCase = new ListServersUseCase(),
    private readonly getServerUseCase: GetServerUseCase = new GetServerUseCase(),
    private readonly updateServerUseCase: UpdateServerUseCase = new UpdateServerUseCase(),
    private readonly deleteServerUseCase: DeleteServerUseCase = new DeleteServerUseCase(),
    private readonly testServerConnectionUseCase: TestServerConnectionUseCase = new TestServerConnectionUseCase(),
    private readonly listConnectedServersUseCase: ListConnectedServersUseCase = new ListConnectedServersUseCase(),
  ) {
    super()
  }

  protected registerRoutes(app: FastifyInstance): void {
    /* GET */
    app.get<{ Params: OrganizationParams; Querystring: MetricsQuery }>('/', {
      schema: listServersSchema,
      handler: this.list.bind(this),
      onRequest: [
        /* Middlewares */
        new EnsureAuthenticateHook().handler(),
        new EnsurePermissionHook().require({ organization: ['server:view'] }),
      ],
    })

    app.get<{ Params: OrganizationParams }>('/connected', {
      schema: listConnectedServersSchema,
      handler: this.listConnected.bind(this),
      onRequest: [
        /* Middlewares */
        new EnsureAuthenticateHook().handler(),
        new EnsurePermissionHook().require({ organization: ['server:view'] }),
      ],
    })

    app.get<{ Params: ServerParams; Querystring: MetricsQuery }>('/:serverId', {
      schema: getServerSchema,
      handler: this.get.bind(this),
      onRequest: [
        /* Middlewares */
        new EnsureAuthenticateHook().handler(),
        new EnsurePermissionHook().require({ organization: ['server:view'] }),
      ],
    })

    /* POST */
    app.post<{ Params: OrganizationParams; Body: CreateServerBody }>('/', {
      schema: createServerSchema,
      handler: this.create.bind(this),
      onRequest: [
        /* Middlewares */
        new EnsureAuthenticateHook().handler(),
        new EnsurePermissionHook().require({ organization: ['server:create'] }),
      ],
    })

    app.post<{ Params: ServerParams }>('/:serverId/test-connection', {
      schema: testServerConnectionSchema,
      handler: this.testConnection.bind(this),
      onRequest: [
        /* Middlewares */
        new EnsureAuthenticateHook().handler(),
        new EnsurePermissionHook().require({ organization: ['server:view'] }),
      ],
    })

    /* PATCH */
    app.patch<{ Params: ServerParams; Body: UpdateServerBody }>('/:serverId', {
      schema: updateServerSchema,
      handler: this.update.bind(this),
      onRequest: [
        /* Middlewares */
        new EnsureAuthenticateHook().handler(),
        new EnsurePermissionHook().require({ organization: ['server:update'] }),
      ],
    })

    /* DELETE */
    app.delete<{ Params: ServerParams }>('/:serverId', {
      schema: deleteServerSchema,
      handler: this.delete.bind(this),
      onRequest: [
        /* Middlewares */
        new EnsureAuthenticateHook().handler(),
        new EnsurePermissionHook().require({ organization: ['server:delete'] }),
      ],
    })
  }

  private async list(
    request: FastifyRequest<{ Params: OrganizationParams; Querystring: MetricsQuery }>,
    reply: FastifyReply,
  ) {
    const { access } = request

    // --> these routes only ask for organization permissions, so the access always comes from a membership
    if (access.via !== 'membership') {
      throw new ForbiddenError()
    }

    const servers = await this.listServersUseCase.execute({
      organizationId: request.params.organizationId,
      membershipId: access.membershipId,
      canAccessAll: access.permissions.includes('server:access-all'),
      history: request.query.history,
    })

    return this.ok(reply, servers)
  }

  private async listConnected(request: FastifyRequest<{ Params: OrganizationParams }>, reply: FastifyReply) {
    const { access } = request

    // --> these routes only ask for organization permissions, so the access always comes from a membership
    if (access.via !== 'membership') {
      throw new ForbiddenError()
    }

    const servers = await this.listConnectedServersUseCase.execute({
      organizationId: request.params.organizationId,
      membershipId: access.membershipId,
      canAccessAll: access.permissions.includes('server:access-all'),
    })

    return this.ok(reply, servers)
  }

  private async get(request: FastifyRequest<{ Params: ServerParams; Querystring: MetricsQuery }>, reply: FastifyReply) {
    const server = await this.getServerUseCase.execute({
      serverId: request.params.serverId,
      history: request.query.history,
    })

    return this.ok(reply, server)
  }

  private async create(
    request: FastifyRequest<{ Params: OrganizationParams; Body: CreateServerBody }>,
    reply: FastifyReply,
  ) {
    const server = await this.createServerUseCase.execute({
      ...request.body,
      userId: request.user.userId,
      organizationId: request.params.organizationId,
    })

    return this.created(reply, server)
  }

  private async testConnection(request: FastifyRequest<{ Params: ServerParams }>, reply: FastifyReply) {
    const result = await this.testServerConnectionUseCase.execute({ serverId: request.params.serverId })

    return this.ok(reply, result)
  }

  private async update(request: FastifyRequest<{ Params: ServerParams; Body: UpdateServerBody }>, reply: FastifyReply) {
    const server = await this.updateServerUseCase.execute({
      ...request.body,
      userId: request.user.userId,
      serverId: request.params.serverId,
    })

    return this.ok(reply, server)
  }

  private async delete(request: FastifyRequest<{ Params: ServerParams }>, reply: FastifyReply) {
    await this.deleteServerUseCase.execute({
      userId: request.user.userId,
      serverId: request.params.serverId,
    })

    return this.noContent(reply)
  }
}
