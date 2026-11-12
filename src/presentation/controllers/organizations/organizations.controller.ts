import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import CreateOrganizationUseCase from '@/domain/use-cases/organizations/create-organization.usecase.js'
import ListMyOrganizationsUseCase from '@/domain/use-cases/organizations/list-my-organizations.usecase.js'
import EnsureAuthenticateHook from '../../hooks/ensure-authenticate.hook.js'
import BaseController from '../base.controller.js'
import {
  type CreateOrganizationBody,
  createOrganizationSchema,
  listMyOrganizationsSchema,
} from './organizations.schemas.js'

export default class OrganizationsController extends BaseController {
  protected readonly prefix = '/organizations'

  constructor(
    private readonly createOrganizationUseCase: CreateOrganizationUseCase = new CreateOrganizationUseCase(),
    private readonly listMyOrganizationsUseCase: ListMyOrganizationsUseCase = new ListMyOrganizationsUseCase(),
  ) {
    super()
  }

  protected registerRoutes(app: FastifyInstance): void {
    /* GET */
    app.get('/', {
      schema: listMyOrganizationsSchema,
      handler: this.listMine.bind(this),
      onRequest: [
        /* Middlewares */
        new EnsureAuthenticateHook().handler(),
      ],
    })

    /* POST */
    app.post<{ Body: CreateOrganizationBody }>('/', {
      schema: createOrganizationSchema,
      handler: this.create.bind(this),
      onRequest: [
        /* Middlewares */
        new EnsureAuthenticateHook().handler(),
      ],
    })
  }

  private async listMine(request: FastifyRequest, reply: FastifyReply) {
    const organizations = await this.listMyOrganizationsUseCase.execute({ userId: request.user.userId })

    return this.ok(reply, organizations)
  }

  private async create(request: FastifyRequest<{ Body: CreateOrganizationBody }>, reply: FastifyReply) {
    const organization = await this.createOrganizationUseCase.execute({
      userId: request.user.userId,
      name: request.body.name,
    })

    return this.created(reply, organization)
  }
}
