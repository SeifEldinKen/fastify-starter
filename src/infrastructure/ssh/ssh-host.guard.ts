import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { getEnv } from '@/shared/config/env-manager.js'
import ValidationError from '@/shared/errors/validation.error.js'

// --> Addresses that only exist inside a network: this machine, private ranges, cloud metadata (169.254.169.254) ...
const INTERNAL_ADDRESSES = new BlockList()

INTERNAL_ADDRESSES.addSubnet('0.0.0.0', 8, 'ipv4')
INTERNAL_ADDRESSES.addSubnet('10.0.0.0', 8, 'ipv4')
INTERNAL_ADDRESSES.addSubnet('100.64.0.0', 10, 'ipv4')
INTERNAL_ADDRESSES.addSubnet('127.0.0.0', 8, 'ipv4')
INTERNAL_ADDRESSES.addSubnet('169.254.0.0', 16, 'ipv4')
INTERNAL_ADDRESSES.addSubnet('172.16.0.0', 12, 'ipv4')
INTERNAL_ADDRESSES.addSubnet('192.0.0.0', 24, 'ipv4')
INTERNAL_ADDRESSES.addSubnet('192.168.0.0', 16, 'ipv4')
INTERNAL_ADDRESSES.addSubnet('198.18.0.0', 15, 'ipv4')
INTERNAL_ADDRESSES.addSubnet('224.0.0.0', 4, 'ipv4')
INTERNAL_ADDRESSES.addSubnet('240.0.0.0', 4, 'ipv4')
INTERNAL_ADDRESSES.addAddress('::', 'ipv6')
INTERNAL_ADDRESSES.addAddress('::1', 'ipv6')
INTERNAL_ADDRESSES.addSubnet('fc00::', 7, 'ipv6')
INTERNAL_ADDRESSES.addSubnet('fe80::', 10, 'ipv6')
INTERNAL_ADDRESSES.addSubnet('ff00::', 8, 'ipv6')

// --> Stops the app from being used to reach our own network (SSRF): a customer could add "10.0.0.5" as a server
// and learn from the errors what runs there
export default class SshHostGuard {
  constructor(
    // --> Development needs local test servers, production never connects to an internal address
    private readonly allowInternal: boolean = getEnv('NODE_ENV') !== 'production',
  ) {}

  // --> Returns the IP address to connect to, always connect to it and not to the host name:
  // resolving the name a second time could give another address than the one checked here
  public async resolve(host: string): Promise<string> {
    let addresses: string[]

    try {
      // --> an IP address is returned as it is, a host name is resolved to all its addresses
      addresses = (await lookup(host, { all: true })).map((result) => result.address)
    } catch {
      throw new ValidationError('The server address could not be resolved')
    }

    const [address] = addresses

    if (!address) {
      throw new ValidationError('The server address could not be resolved')
    }

    // --> every address of the name must be public, one internal address is enough to refuse
    if (!this.allowInternal && addresses.some((item) => this.isInternal(item))) {
      throw new ValidationError('This server address is not allowed')
    }

    return address
  }

  private isInternal(address: string): boolean {
    return INTERNAL_ADDRESSES.check(address, isIP(address) === 6 ? 'ipv6' : 'ipv4')
  }
}
