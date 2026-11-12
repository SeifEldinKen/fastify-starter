import type { FirewallAction, FirewallRule, ParsedFirewall } from './firewall.rules.js'

// --> "8080/tcp", "9000-9100/udp"
const PORT_PATTERN = /^(\d+(?:-\d+)?)\/(tcp|udp)$/

const RICH_RULE_ACTIONS: Record<string, FirewallAction> = {
  accept: 'allow',
  drop: 'deny',
  reject: 'reject',
}

interface FirewalldOutput {
  // --> Output of "firewall-cmd --permanent --zone=... --list-all": what is saved, and comes back after a restart
  permanent: string[]
  // --> One "name port/protocol port/protocol" per line, for every service name used by the zone
  services: string[]
}

export interface FirewalldZone {
  target: string
  services: string[]
  ports: string[]
  richRules: string[]
  // --> Ports sent to another port or machine: one "port=81:proto=tcp:toport=8081" per line
  forwardPorts: string[]
}

// --> Reads the output of "--list-all": "  key: values" lines, then one rich rule per line
export const readFirewalldZone = (lines: string[]): FirewalldZone => {
  const values = new Map<string, string>()
  const richRules: string[] = []
  const forwardPorts: string[] = []
  let section = ''

  for (const line of lines) {
    // --> these two lists are printed one item per line, under their key
    if (section === 'rich rules' && line.trim().startsWith('rule')) {
      richRules.push(line.trim())
      continue
    }

    if (section === 'forward-ports' && line.trim().startsWith('port=')) {
      forwardPorts.push(line.trim())
      continue
    }

    const separator = line.indexOf(':')

    if (separator === -1) {
      continue
    }

    const key = line.slice(0, separator).trim()

    section = key
    values.set(key, line.slice(separator + 1).trim())
  }

  const toList = (key: string): string[] => (values.get(key) ?? '').split(/\s+/).filter(Boolean)

  return {
    target: values.get('target') ?? 'default',
    services: toList('services'),
    ports: toList('ports'),
    richRules,
    forwardPorts,
  }
}

// --> Turns the text of firewalld into the rules every tool shares
export const parseFirewalld = (output: FirewalldOutput): ParsedFirewall => {
  const zone = readFirewalldZone(output.permanent)

  // --> parse services, a name like "ssh" stands for one or more ports
  const portsOfService = new Map<string, string[]>()

  for (const line of output.services) {
    const [name, ...ports] = line.trim().split(/\s+/)

    if (name) {
      portsOfService.set(name, ports)
    }
  }

  const rules: FirewallRule[] = []
  // --> forwarded ports are not rules this shape can show
  let unsupportedRules = zone.forwardPorts.length

  // --> adds one rule per port, false when a port is not one this shape can show
  const addRules = (ports: string[], rule: Omit<FirewallRule, 'port' | 'protocol'>): boolean => {
    const found = ports.map((port) => PORT_PATTERN.exec(port))

    if (found.length === 0 || found.includes(null)) {
      return false
    }

    for (const match of found) {
      rules.push({ ...rule, port: match?.[1] ?? null, protocol: match?.[2] as FirewallRule['protocol'] })
    }

    return true
  }

  // --> services and ports of the zone are open to everyone
  const openToAll = {
    action: 'allow',
    direction: 'in',
    source: 'any',
    ipVersion: 'both',
    interface: null,
    comment: null,
  } as const

  for (const service of zone.services) {
    if (!addRules(portsOfService.get(service) ?? [], openToAll)) {
      unsupportedRules++
    }
  }

  for (const port of zone.ports) {
    if (!addRules([port], openToAll)) {
      unsupportedRules++
    }
  }

  // --> parse rich rules: 'rule family="ipv4" source address="203.0.113.10" port port="5432" protocol="tcp" accept'
  for (const richRule of zone.richRules) {
    let rest = richRule.replace(/^rule\b/, '')

    // --> takes one known part out of the rule, what is left at the end is what this parser does not know
    const take = (pattern: RegExp): RegExpExecArray | null => {
      const match = pattern.exec(rest)

      rest = match ? rest.replace(match[0], ' ') : rest

      return match
    }

    const family = take(/\bfamily="(ipv4|ipv6)"/)?.[1]
    const source = take(/\bsource address="([^"]+)"/)?.[1] ?? 'any'
    const port = take(/\bport port="(\d+(?:-\d+)?)" protocol="(tcp|udp)"/)
    const service = take(/\bservice name="([^"]+)"/)?.[1]
    const action = RICH_RULE_ACTIONS[take(/\b(accept|reject|drop)\b(?: type="[^"]*")?/)?.[1] ?? '']

    take(/\bpriority="-?\d+"/)

    // --> logging, forwarding, a rule on the destination, on a protocol ... are not shown
    if (rest.trim() !== '' || !action || (port && service)) {
      unsupportedRules++
      continue
    }

    const rule = {
      action,
      direction: 'in',
      source,
      ipVersion: family === 'ipv4' ? 'v4' : family === 'ipv6' ? 'v6' : 'both',
      interface: null,
      comment: null,
    } as const

    if (port) {
      rules.push({ ...rule, port: port[1] ?? null, protocol: port[2] as FirewallRule['protocol'] })
    } else if (service) {
      if (!addRules(portsOfService.get(service) ?? [], rule)) {
        unsupportedRules++
      }
    } else {
      // --> no port: the rule is for every port
      rules.push({ ...rule, port: null, protocol: 'any' })
    }
  }

  return {
    enabled: true,
    defaults: {
      // --> the "target" of the zone is what happens to a connection no rule matches, "default" rejects it
      incoming: zone.target === 'ACCEPT' ? 'allow' : 'deny',
      // --> firewalld does not filter what leaves the server
      outgoing: 'allow',
    },
    rules,
    unsupportedRules,
  }
}
