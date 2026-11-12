import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import AddFirewallRulesUseCase from '@/domain/use-cases/firewall/add-firewall-rules.usecase.js'
import DeleteFirewallRuleUseCase from '@/domain/use-cases/firewall/delete-firewall-rule.usecase.js'
import GetFirewallUseCase from '@/domain/use-cases/firewall/get-firewall.usecase.js'
import EnsureAuthenticateHook from '../../hooks/ensure-authenticate.hook.js'
import EnsurePermissionHook from '../../hooks/ensure-permission.hook.js'
import BaseController from '../base.controller.js'
import type { SudoPasswordHeaders } from '../shared.schemas.js'
import {
  type AddFirewallRulesBody,
  addFirewallRulesSchema,
  type DeleteFirewallRuleQuery,
  deleteFirewallRuleSchema,
  getFirewallSchema,
  type ServerParams,
} from './firewall.schemas.js'

export default class FirewallController extends BaseController {
  protected readonly prefix = '/organizations/:organizationId/servers/:serverId/firewall'

  constructor(
    private readonly getFirewallUseCase: GetFirewallUseCase = new GetFirewallUseCase(),
    private readonly addFirewallRulesUseCase: AddFirewallRulesUseCase = new AddFirewallRulesUseCase(),
    private readonly deleteFirewallRuleUseCase: DeleteFirewallRuleUseCase = new DeleteFirewallRuleUseCase(),
  ) {
    super()
  }

  protected registerRoutes(app: FastifyInstance): void {
    /* GET */
    app.get<{ Params: ServerParams; Headers: SudoPasswordHeaders }>('/', {
      schema: getFirewallSchema,
      handler: this.get.bind(this),
      onRequest: [
        /* Middlewares */
        new EnsureAuthenticateHook().handler(),
        new EnsurePermissionHook().require({ organization: ['firewall:view'] }),
      ],
    })

    /* POST */
    app.post<{ Params: ServerParams; Body: AddFirewallRulesBody; Headers: SudoPasswordHeaders }>('/rules', {
      schema: addFirewallRulesSchema,
      handler: this.addRules.bind(this),
      onRequest: [
        /* Middlewares */
        new EnsureAuthenticateHook().handler(),
        new EnsurePermissionHook().require({ organization: ['firewall:manage'] }),
      ],
    })

    /* DELETE */
    app.delete<{ Params: ServerParams; Querystring: DeleteFirewallRuleQuery; Headers: SudoPasswordHeaders }>('/rules', {
      schema: deleteFirewallRuleSchema,
      handler: this.deleteRule.bind(this),
      onRequest: [
        /* Middlewares */
        new EnsureAuthenticateHook().handler(),
        new EnsurePermissionHook().require({ organization: ['firewall:manage'] }),
      ],
    })
  }

  private async get(
    request: FastifyRequest<{ Params: ServerParams; Headers: SudoPasswordHeaders }>,
    reply: FastifyReply,
  ) {
    const firewall = await this.getFirewallUseCase.execute({
      serverId: request.params.serverId,
      sudoPassword: request.headers['x-sudo-password'],
    })

    return this.ok(reply, firewall)
  }

  private async addRules(
    request: FastifyRequest<{ Params: ServerParams; Body: AddFirewallRulesBody; Headers: SudoPasswordHeaders }>,
    reply: FastifyReply,
  ) {
    const firewall = await this.addFirewallRulesUseCase.execute({
      ...request.body,
      userId: request.user.userId,
      organizationId: request.params.organizationId,
      serverId: request.params.serverId,
      sudoPassword: request.headers['x-sudo-password'],
    })

    return this.created(reply, firewall)
  }

  private async deleteRule(
    request: FastifyRequest<{
      Params: ServerParams
      Querystring: DeleteFirewallRuleQuery
      Headers: SudoPasswordHeaders
    }>,
    reply: FastifyReply,
  ) {
    const firewall = await this.deleteFirewallRuleUseCase.execute({
      ...request.query,
      userId: request.user.userId,
      organizationId: request.params.organizationId,
      serverId: request.params.serverId,
      sudoPassword: request.headers['x-sudo-password'],
    })

    return this.ok(reply, firewall)
  }
}
