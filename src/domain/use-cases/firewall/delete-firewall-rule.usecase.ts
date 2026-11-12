import type { PrismaClient } from '@/generated/prisma/client.js'
import { prismaDb } from '@/infrastructure/database/prisma.js'
import FirewallError from '@/shared/errors/firewall.error.js'
import NotFoundError from '@/shared/errors/not-found.error.js'
import ValidationError from '@/shared/errors/validation.error.js'
import {
  FIREWALL_ACTIONS,
  type FirewallAction,
  type FirewallRule,
  isFirewallPort,
  isFirewallSource,
  isSameRule,
} from './firewall.rules.js'
import FirewallChangeRunner from './firewall-change.runner.js'
import GetFirewallUseCase, { type GetFirewallResponse } from './get-firewall.usecase.js'

interface DeleteFirewallRuleRequest {
  // --> From request.user and the route, both already checked by the hooks
  userId: string
  organizationId: string
  serverId: string
  // --> The rule is named by what it holds, as the firewall route returns it: a number would change after every delete
  action: FirewallAction
  port?: string | undefined
  protocol: FirewallRule['protocol']
  // --> "any", an address or a network
  source: string
  // --> Sudo password of the account on the server, only for an account whose sudo asks for one. Never saved
  sudoPassword?: string | undefined
}

// --> Deletes one incoming rule from the firewall of a server. Needs root rights
export default class DeleteFirewallRuleUseCase {
  constructor(
    private readonly db: PrismaClient = prismaDb,
    private readonly getFirewall: GetFirewallUseCase = new GetFirewallUseCase(),
    private readonly changeRunner: FirewallChangeRunner = new FirewallChangeRunner(),
  ) {}

  public async execute(request: DeleteFirewallRuleRequest): Promise<GetFirewallResponse> {
    const { userId, organizationId, serverId, action, protocol, source, sudoPassword } = request
    const port = request.port ?? null

    // --> every value is checked here too, whatever the caller already did: they all reach a root shell
    if (!FIREWALL_ACTIONS.includes(action)) {
      throw new ValidationError('Not a valid action')
    }

    if (!['tcp', 'udp', 'any'].includes(protocol)) {
      throw new ValidationError('Not a valid protocol')
    }

    if (port !== null && !isFirewallPort(port, { allowList: true })) {
      throw new ValidationError('Not a valid port')
    }

    if (source !== 'any' && !isFirewallSource(source)) {
      throw new ValidationError('The source is not a valid address or network')
    }

    // --> read the firewall as it is now
    const firewall = await this.getFirewall.read({ serverId, sudoPassword })

    // --> firewalld cannot be changed while it is stopped, ufw can
    if (!firewall.manageable || (firewall.backend === 'firewalld' && !firewall.enabled)) {
      throw new FirewallError(
        'FIREWALL_NOT_MANAGEABLE',
        'The firewall of this server is not managed by ufw or by a running firewalld',
      )
    }

    // --> find the rule
    const rule = firewall.rules.find((candidate) => isSameRule(candidate, { action, port, protocol, source }))

    if (!rule) {
      throw new NotFoundError('Firewall rule not found')
    }

    // --> refuse to delete the last rule that lets the panel reach SSH
    const protectedRules = firewall.rules.filter((candidate) => candidate.protected)

    if (rule.protected && protectedRules.length === 1 && firewall.enabled && firewall.defaults?.incoming === 'deny') {
      throw new FirewallError(
        'FIREWALL_WOULD_LOCK_OUT',
        'This is the only rule that lets the panel reach the server, add another one before deleting it',
      )
    }

    // --> apply the change, it is undone by the server when the panel cannot connect anymore
    await this.changeRunner.run({
      serverId,
      backend: firewall.backend as 'ufw' | 'firewalld',
      sudoPassword,
      change: {
        operation: 'delete',
        action,
        port,
        protocol,
        sources: [source],
        comment: '',
      },
    })

    // --> save who deleted it
    await this.db.auditLog.create({
      data: {
        organizationId,
        userId,
        serverId,
        action: 'firewall.rule.delete',
        metadata: {
          action,
          port,
          protocol,
          source,
        },
      },
    })

    // --> read the firewall back from the server: the response shows what really exists there
    return this.getFirewall.execute({ serverId, sudoPassword })
  }
}
