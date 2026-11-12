import GetServerConnectionUseCase from '@/domain/use-cases/ssh/get-server-connection.usecase.js'
import { FIREWALL_MARKER, getFirewallScript } from '@/infrastructure/ssh/scripts/get-firewall.script.js'
import type SshCommandRunner from '@/infrastructure/ssh/ssh-command.runner.js'
import { sshCommandRunner } from '@/infrastructure/ssh/ssh-command.runner.js'
import SshConnectionError from '@/shared/errors/ssh-connection.error.js'
import {
  allowsSshFrom,
  FIREWALL_BACKENDS,
  type FirewallBackend,
  type FirewallPolicy,
  type FirewallRule,
  type ParsedFirewall,
} from './firewall.rules.js'
import { parseFirewalld, readFirewalldZone } from './firewalld.parser.js'
import { parseUfw } from './ufw.parser.js'

export const FIREWALL_WARNING_CODES = [
  'DOCKER_BYPASS',
  'SSH_NOT_ALLOWED',
  'UNSUPPORTED_RULES',
  'UNSAVED_CHANGES',
  'OTHER_ZONES',
  'FIREWALL_STOPPED',
  'MANAGED_BY_HAND',
] as const

interface FirewallWarning {
  code: (typeof FIREWALL_WARNING_CODES)[number]
  message: string
}

interface GetFirewallRequest {
  // --> EnsurePermissionHook already checked it belongs to the organization and the member can access it
  serverId: string
  // --> Sudo password of the account on the server, only for an account whose sudo asks for one. Never saved
  sudoPassword?: string | undefined
}

export interface GetFirewallResponse {
  // --> The tool that manages the firewall: "raw" is rules written by hand, "none" is no firewall at all
  backend: FirewallBackend
  // --> false for "raw" and "none": the panel only changes the rules of a tool it knows
  manageable: boolean
  enabled: boolean
  // --> What happens to a connection no rule matches, null when no known tool manages the firewall
  defaults: {
    incoming: FirewallPolicy
    outgoing: FirewallPolicy
  } | null
  // --> The port the panel is connected to, as the server sees it
  sshPort: number | null
  rules: (FirewallRule & {
    // --> true when this rule lets the panel reach SSH: removing it could lock the panel out of the server
    protected: boolean
  })[]
  warnings: FirewallWarning[]
}

// --> State and rules of the firewall of a server, whatever tool manages it. Needs root rights
export default class GetFirewallUseCase {
  constructor(
    private readonly getServerConnection: GetServerConnectionUseCase = new GetServerConnectionUseCase(),
    private readonly commandRunner: SshCommandRunner = sshCommandRunner,
  ) {}

  public async execute(request: GetFirewallRequest): Promise<GetFirewallResponse> {
    // --> the address of the panel is for the use cases that change the firewall, it is not part of the answer
    const { panelAddress: _panelAddress, ...firewall } = await this.read(request)

    return firewall
  }

  // --> Same as execute, with the address the server sees the panel coming from
  public async read({
    serverId,
    sudoPassword,
  }: GetFirewallRequest): Promise<GetFirewallResponse & { panelAddress: string }> {
    // --> get the connection of the server and run the script
    const connection = await this.getServerConnection.execute({ serverId })

    // --> execute the script
    const { stdout } = await this.commandRunner.runScript(connection, { script: getFirewallScript(), sudoPassword })

    // --> split the output into its parts: a marker line "NAME values" starts a part, the lines after it are its content
    const parts = new Map<string, { values: string[]; lines: string[] }>()
    let current: { values: string[]; lines: string[] } | undefined

    for (const line of stdout.split('\n')) {
      if (line.startsWith(FIREWALL_MARKER)) {
        const [name = '', ...values] = line.slice(FIREWALL_MARKER.length).trim().split(/\s+/)

        current = { values, lines: [] }
        parts.set(name, current)
      } else {
        current?.lines.push(line.trimEnd())
      }
    }

    const [backend, active] = parts.get('BACKEND')?.values ?? []

    // --> without the last marker the output was cut
    if (!this.isBackend(backend) || !parts.has('END')) {
      throw new SshConnectionError('SSH_COMMAND_FAILED', 'The server did not return its firewall')
    }

    // --> SSH_CONNECTION is "panel address, panel port, server address, server port"
    const [panelAddress = '', , , rawSshPort = ''] = parts.get('SSH')?.values ?? []
    const sshPort = /^\d+$/.test(rawSshPort) ? Number(rawSshPort) : null

    const linesOf = (name: string): string[] => parts.get(name)?.lines ?? []
    const warnings: FirewallWarning[] = []

    // --> parse the output of the tool into the shared shape
    let parsed: ParsedFirewall | null = null

    if (backend === 'ufw') {
      parsed = parseUfw({
        enabled: active === '1',
        defaults: linesOf('DEFAULTS'),
        rules: linesOf('RULES'),
        apps: linesOf('APPS'),
      })
    }

    if (backend === 'firewalld' && active === '1') {
      parsed = parseFirewalld({
        permanent: linesOf('PERMANENT'),
        services: linesOf('SERVICES'),
      })

      // --> firewalld keeps two copies: what runs now, and what is saved. A change made in one only is lost or pending
      const saved = readFirewalldZone(linesOf('PERMANENT'))
      const running = readFirewalldZone(linesOf('RUNTIME'))
      const signature = (zone: typeof saved) =>
        JSON.stringify([
          zone.target,
          zone.services.sort(),
          zone.ports.sort(),
          zone.richRules.sort(),
          zone.forwardPorts.sort(),
        ])

      if (signature(saved) !== signature(running)) {
        warnings.push({
          code: 'UNSAVED_CHANGES',
          message:
            'The rules running now differ from the saved ones shown here, a reload or a restart will change them',
        })
      }

      // --> a zone name starts its line, its network cards and sources are indented under it
      const zoneName = parts.get('ZONE')?.values[0]
      const otherZones = linesOf('ACTIVE_ZONES').filter((line) => /^\S/.test(line) && line.trim() !== zoneName)

      if (otherZones.length > 0) {
        warnings.push({
          code: 'OTHER_ZONES',
          message: `Only the zone "${zoneName}" is shown, other zones are in use too: ${otherZones.join(', ')}`,
        })
      }
    }

    if (backend === 'firewalld' && active !== '1') {
      warnings.push({
        code: 'FIREWALL_STOPPED',
        message: 'firewalld is installed but not running, its rules cannot be read while it is stopped',
      })
    }

    if (backend === 'raw') {
      warnings.push({
        code: 'MANAGED_BY_HAND',
        message: 'This server has firewall rules written without ufw or firewalld, they are not shown and not changed',
      })
    }

    // --> mark the rules that let the panel reach SSH
    const rules = (parsed?.rules ?? []).map((rule) => ({
      ...rule,
      protected: sshPort !== null && allowsSshFrom(rule, sshPort, panelAddress),
    }))

    if (parsed && parsed.unsupportedRules > 0) {
      warnings.push({
        code: 'UNSUPPORTED_RULES',
        message: `${parsed.unsupportedRules} rule(s) of the server are not shown: forwarding, logging, or options this panel does not handle`,
      })
    }

    if (parsed && parsed.defaults.incoming === 'deny' && !rules.some((rule) => rule.protected)) {
      warnings.push({
        code: 'SSH_NOT_ALLOWED',
        message: parsed.enabled
          ? 'No rule allows the panel to reach SSH, a new connection to this server may be refused'
          : 'No rule allows the panel to reach SSH, enabling the firewall would lock the panel out',
      })
    }

    // --> Docker opens the ports of its containers by itself, before the rules of these tools are read
    if (parts.has('DOCKER') && parsed) {
      warnings.push({
        code: 'DOCKER_BYPASS',
        message: 'Docker publishes the ports of its containers past this firewall, a port not allowed here can be open',
      })
    }

    return {
      backend,
      manageable: backend === 'ufw' || backend === 'firewalld',
      // --> rules written by hand are in effect, even if no tool can tell
      enabled: parsed?.enabled ?? backend === 'raw',
      defaults: parsed?.defaults ?? null,
      sshPort,
      rules,
      warnings,
      panelAddress,
    }
  }

  private isBackend(value: string | undefined): value is FirewallBackend {
    return FIREWALL_BACKENDS.includes(value as FirewallBackend)
  }
}
