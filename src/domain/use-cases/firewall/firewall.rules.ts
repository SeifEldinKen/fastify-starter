import { BlockList, isIPv4, isIPv6 } from 'node:net'

export const FIREWALL_BACKENDS = ['ufw', 'firewalld', 'raw', 'none'] as const

export type FirewallBackend = (typeof FIREWALL_BACKENDS)[number]

// --> "reject" answers the sender that the port is closed, "deny" stays silent. "limit" allows, but slows repeated tries
export const FIREWALL_ACTIONS = ['allow', 'deny', 'reject', 'limit'] as const

export type FirewallAction = (typeof FIREWALL_ACTIONS)[number]

export type FirewallPolicy = 'allow' | 'deny'

// --> The same shape for every tool: one rule has one source, like in the firewall itself
export interface FirewallRule {
  action: FirewallAction
  direction: 'in' | 'out'
  // --> "443", a range "8000-8100", a list "80,443", null for every port
  port: string | null
  protocol: 'tcp' | 'udp' | 'any'
  // --> "any", one address, or a network like "10.0.0.0/8"
  source: string
  ipVersion: 'v4' | 'v6' | 'both'
  // --> Only on this network card, null for all of them
  interface: string | null
  comment: string | null
}

// --> What a parser returns: the rules it understood, and how many it could not turn into the shape above
export interface ParsedFirewall {
  enabled: boolean
  defaults: {
    incoming: FirewallPolicy
    outgoing: FirewallPolicy
  }
  rules: FirewallRule[]
  unsupportedRules: number
}

// --> true when the port of a rule ("443", "80,443", "8000-8100", or null for all) covers this port
export const coversPort = (rulePort: string | null, port: number): boolean => {
  if (rulePort === null) {
    return true
  }

  return rulePort.split(',').some((part) => {
    const [from, to = from] = part.split('-').map(Number)

    return from !== undefined && to !== undefined && port >= from && port <= to
  })
}

// --> true when the source of a rule ("any", an address, a network) covers this address
export const coversAddress = (source: string, address: string): boolean => {
  if (source === 'any') {
    return true
  }

  const family = isIPv4(address) ? 'ipv4' : isIPv6(address) ? 'ipv6' : null
  const [network = '', prefix] = source.split('/')

  // --> an address of one family is never inside a network of the other one
  if (family === null || (isIPv4(network) ? 'ipv4' : 'ipv6') !== family) {
    return false
  }

  try {
    const list = new BlockList()

    if (prefix === undefined) {
      list.addAddress(network, family)
    } else {
      list.addSubnet(network, Number(prefix), family)
    }

    return list.check(address, family)
  } catch {
    // --> not an address the firewall would accept either
    return false
  }
}

// --> true when this rule lets the given address reach the SSH port: removing it could lock the panel out
export const allowsSshFrom = (rule: FirewallRule, sshPort: number, address: string): boolean => {
  return (
    (rule.action === 'allow' || rule.action === 'limit') &&
    rule.direction === 'in' &&
    rule.interface === null &&
    rule.protocol !== 'udp' &&
    coversPort(rule.port, sshPort) &&
    coversAddress(rule.source, address)
  )
}

// --> One port "443" or a range "8000-8100". A list "80,443" exists in ufw, it is only accepted to delete such a rule
export const isFirewallPort = (text: string, { allowList = false } = {}): boolean => {
  const parts = text.split(',')

  if (parts.length > 1 && !allowList) {
    return false
  }

  return parts.every((part) => {
    const match = /^([1-9]\d{0,4})(?:-([1-9]\d{0,4}))?$/.exec(part)
    const from = Number(match?.[1])
    const to = Number(match?.[2] ?? match?.[1])

    return match !== null && from <= to && to <= 65535
  })
}

// --> One address "203.0.113.10", or a network "10.0.0.0/8", IPv4 or IPv6
export const isFirewallSource = (text: string): boolean => {
  const [address = '', prefix, ...rest] = text.split('/')
  const maxPrefix = isIPv4(address) ? 32 : isIPv6(address) ? 128 : -1

  // --> only digits, letters of hexadecimal, "." and ":" are accepted: an IPv6 address can end with "%" and any text
  if (maxPrefix === -1 || rest.length > 0 || !/^[0-9a-fA-F:.]+$/.test(address)) {
    return false
  }

  return prefix === undefined || (/^(0|[1-9]\d{0,2})$/.test(prefix) && Number(prefix) <= maxPrefix)
}

// --> No quotes and no line break: the comment is one line of the input, and ufw prints it between quotes
export const FIREWALL_COMMENT_PATTERN = /^[a-zA-Z0-9 _.,:@#+=/-]{0,80}$/

interface RuleKey {
  action: FirewallAction
  port: string | null
  protocol: FirewallRule['protocol']
  source: string
}

// --> true when a rule of the server is the one described: only incoming rules on every network card can be described
export const isSameRule = (rule: FirewallRule, key: RuleKey): boolean => {
  return (
    rule.direction === 'in' &&
    rule.interface === null &&
    rule.action === key.action &&
    rule.port === key.port &&
    rule.protocol === key.protocol &&
    rule.source === key.source
  )
}
