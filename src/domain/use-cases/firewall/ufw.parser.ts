import type { FirewallAction, FirewallPolicy, FirewallRule, ParsedFirewall } from './firewall.rules.js'

const ACTIONS: readonly string[] = ['allow', 'deny', 'reject', 'limit']

// --> "22", "80,443", "8000:8100"
const PORT_PATTERN = /^\d+(?:[:,]\d+)*$/

interface UfwOutput {
  enabled: boolean
  // --> Lines of /etc/default/ufw: IPV6=yes, DEFAULT_INPUT_POLICY="DROP" ...
  defaults: string[]
  // --> Output of "ufw show added": one "ufw allow 22/tcp" per line
  rules: string[]
  // --> The files of /etc/ufw/applications.d: "[OpenSSH]" then "ports=22/tcp"
  apps: string[]
}

interface PortAndProtocol {
  port: string | null
  protocol: FirewallRule['protocol']
}

// --> Turns the text of ufw into the rules every tool shares
export const parseUfw = (output: UfwOutput): ParsedFirewall => {
  // --> parse settings, a line is KEY="value"
  const settings = new Map<string, string>()

  for (const line of output.defaults) {
    const [key = '', value = ''] = line.trim().split('=')

    settings.set(key, value.replaceAll('"', '').toLowerCase())
  }

  const toPolicy = (value: string | undefined): FirewallPolicy => (value === 'accept' ? 'allow' : 'deny')
  const hasIpv6 = settings.get('IPV6') === 'yes'

  // --> parse applications, a name like "OpenSSH" stands for ports: "22/tcp", or "80,443/tcp", or "137/udp|139/tcp"
  const apps = new Map<string, string[]>()
  let currentApp = ''

  for (const line of output.apps) {
    const section = /^\[(.+)\]$/.exec(line.trim())

    if (section) {
      currentApp = section[1] ?? ''
    } else if (line.trim().startsWith('ports=') && currentApp) {
      apps.set(currentApp, line.trim().slice('ports='.length).split('|'))
    }
  }

  // --> "80,443/tcp" to its port and protocol, null when it is not a port
  const toPort = (text: string): PortAndProtocol | null => {
    const [port = '', protocol = 'any'] = text.trim().split('/')

    if (!PORT_PATTERN.test(port) || !['tcp', 'udp', 'any'].includes(protocol)) {
      return null
    }

    return { port: port.replaceAll(':', '-'), protocol: protocol as FirewallRule['protocol'] }
  }

  // --> parse rules
  const rules: FirewallRule[] = []
  let unsupportedRules = 0

  for (const line of output.rules) {
    if (!line.startsWith('ufw ')) {
      continue
    }

    // --> the comment is the last part, and the only one that can hold spaces
    const comment = / comment '(.*)'$/.exec(line)
    const words = line
      .slice('ufw '.length, comment ? comment.index : undefined)
      .trim()
      .split(/\s+/)

    const action = words.shift() ?? ''

    // --> "route" rules are for traffic passing through the server to another machine, not shown
    if (!ACTIONS.includes(action)) {
      unsupportedRules++
      continue
    }

    let direction: FirewallRule['direction'] = 'in'
    let networkInterface: string | null = null
    let source = 'any'
    let protocol: FirewallRule['protocol'] | null = null
    // --> one rule can stand for several ports when it names an application
    let ports: PortAndProtocol[] = [{ port: null, protocol: 'any' }]
    let isSupported = true

    if (words[0] === 'in' || words[0] === 'out') {
      direction = words.shift() as FirewallRule['direction']
    }

    if (words[0] === 'on') {
      words.shift()
      networkInterface = words.shift() ?? null
    }

    if (words[0] === 'log' || words[0] === 'log-all') {
      words.shift()
    }

    if (words.length === 1) {
      // --> short form: "22/tcp", "80", or the name of an application
      const word = words[0] ?? ''
      const fromApp = apps.get(word)?.map(toPort)
      const found = fromApp ?? [toPort(word)]

      if (found.includes(null)) {
        isSupported = false
      } else {
        ports = found as PortAndProtocol[]
      }
    } else {
      // --> long form: "from 203.0.113.10 to any port 5432 proto tcp"
      let side: 'from' | 'to' = 'to'

      while (words.length > 0) {
        const word = words.shift()
        const value = words.shift() ?? ''

        if (word === 'from') {
          side = 'from'
          source = value
        } else if (word === 'to') {
          side = 'to'
          // --> a rule for one address of the server only cannot be shown with this shape
          isSupported &&= value === 'any'
        } else if (word === 'proto') {
          isSupported &&= value === 'tcp' || value === 'udp'
          protocol = value as FirewallRule['protocol']
        } else if (word === 'port' && side === 'to') {
          const found = toPort(value)

          isSupported &&= found !== null
          ports = found ? [found] : ports
        } else if (word === 'app' && side === 'to') {
          const found = apps.get(value)?.map(toPort) ?? [null]

          isSupported &&= !found.includes(null)
          ports = found.includes(null) ? ports : (found as PortAndProtocol[])
        } else {
          // --> a rule on the port the connection comes from, or a word this parser does not know
          isSupported = false
        }
      }
    }

    if (!isSupported) {
      unsupportedRules++
      continue
    }

    for (const found of ports) {
      rules.push({
        action: action as FirewallAction,
        direction,
        port: found.port,
        protocol: protocol ?? found.protocol,
        source,
        // --> a rule without address is added for both versions when the server uses IPv6
        ipVersion: source === 'any' ? (hasIpv6 ? 'both' : 'v4') : source.includes(':') ? 'v6' : 'v4',
        interface: networkInterface,
        comment: comment?.[1] ?? null,
      })
    }
  }

  return {
    enabled: output.enabled,
    defaults: {
      incoming: toPolicy(settings.get('DEFAULT_INPUT_POLICY')),
      outgoing: toPolicy(settings.get('DEFAULT_OUTPUT_POLICY')),
    },
    rules,
    unsupportedRules,
  }
}
