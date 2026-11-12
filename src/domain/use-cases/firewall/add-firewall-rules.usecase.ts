import type { PrismaClient } from '@/generated/prisma/client.js'
import { prismaDb } from '@/infrastructure/database/prisma.js'
import ConflictError from '@/shared/errors/conflict.error.js'
import FirewallError from '@/shared/errors/firewall.error.js'
import ValidationError from '@/shared/errors/validation.error.js'
import {
  coversAddress,
  coversPort,
  FIREWALL_COMMENT_PATTERN,
  isFirewallPort,
  isFirewallSource,
  isSameRule,
} from './firewall.rules.js'
import FirewallChangeRunner from './firewall-change.runner.js'
import GetFirewallUseCase, { type GetFirewallResponse } from './get-firewall.usecase.js'

export const MAX_FIREWALL_SOURCES = 20

interface AddFirewallRulesRequest {
  // --> From request.user and the route, both already checked by the hooks
  userId: string
  organizationId: string
  serverId: string
  action: 'allow' | 'deny'
  // --> "443" or a range "8000-8100", undefined for every port
  port?: string | undefined
  protocol: 'tcp' | 'udp'
  // --> Addresses or networks, one rule is added for each. Empty for everyone
  sources: string[]
  comment: string
  // --> Sudo password of the account on the server, only for an account whose sudo asks for one. Never saved
  sudoPassword?: string | undefined
}

// --> Adds incoming rules to the firewall of a server, one for each source. Needs root rights
export default class AddFirewallRulesUseCase {
  constructor(
    private readonly db: PrismaClient = prismaDb,
    private readonly getFirewall: GetFirewallUseCase = new GetFirewallUseCase(),
    private readonly changeRunner: FirewallChangeRunner = new FirewallChangeRunner(),
  ) {}

  public async execute(request: AddFirewallRulesRequest): Promise<GetFirewallResponse> {
    const { userId, organizationId, serverId, action, protocol, comment, sudoPassword } = request
    const port = request.port ?? null

    // --> every value is checked here too, whatever the caller already did: they all reach a root shell
    if (action !== 'allow' && action !== 'deny') {
      throw new ValidationError('The action must be "allow" or "deny"')
    }

    if (protocol !== 'tcp' && protocol !== 'udp') {
      throw new ValidationError('The protocol must be "tcp" or "udp"')
    }

    if (port !== null && !isFirewallPort(port)) {
      throw new ValidationError('Not a valid port or range of ports')
    }

    if (request.sources.length > MAX_FIREWALL_SOURCES || request.sources.some((source) => !isFirewallSource(source))) {
      throw new ValidationError('A source is not a valid address or network')
    }

    if (port === null && request.sources.length === 0) {
      throw new ValidationError('A rule for every port needs at least one source')
    }

    if (!FIREWALL_COMMENT_PATTERN.test(comment)) {
      throw new ValidationError('The comment holds characters that are not allowed')
    }

    // --> no source means everyone
    const sources = request.sources.length > 0 ? [...new Set(request.sources)] : ['any']

    // --> read the firewall as it is now
    const firewall = await this.getFirewall.read({ serverId, sudoPassword })

    // --> firewalld cannot be changed while it is stopped, ufw can
    if (!firewall.manageable || (firewall.backend === 'firewalld' && !firewall.enabled)) {
      throw new FirewallError(
        'FIREWALL_NOT_MANAGEABLE',
        'The firewall of this server is not managed by ufw or by a running firewalld',
      )
    }

    // --> check if a rule already exists
    const existingSource = sources.find((source) =>
      firewall.rules.some((rule) => isSameRule(rule, { action, port, protocol, source })),
    )

    if (existingSource) {
      throw new ConflictError('FIREWALL_RULE_ALREADY_EXISTS', `This rule already exists for "${existingSource}"`)
    }

    // --> refuse a rule that blocks the panel itself from SSH
    const blocksPanel =
      action === 'deny' &&
      protocol === 'tcp' &&
      firewall.sshPort !== null &&
      coversPort(port, firewall.sshPort) &&
      sources.some((source) => coversAddress(source, firewall.panelAddress))

    if (blocksPanel) {
      throw new FirewallError('FIREWALL_WOULD_LOCK_OUT', 'This rule would block the panel from reaching the server')
    }

    // --> apply the change, it is undone by the server when the panel cannot connect anymore
    await this.changeRunner.run({
      serverId,
      backend: firewall.backend as 'ufw' | 'firewalld',
      change: { operation: 'add', action, port, protocol, sources, comment },
      sudoPassword,
    })

    // --> save who added it
    await this.db.auditLog.create({
      data: {
        organizationId,
        userId,
        serverId,
        action: 'firewall.rule.add',
        metadata: { action, port, protocol, sources, comment },
      },
    })

    // --> read the firewall back from the server: the response shows what really exists there
    return this.getFirewall.execute({ serverId, sudoPassword })
  }
}
