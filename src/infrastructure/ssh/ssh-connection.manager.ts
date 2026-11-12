import { LRUCache } from 'lru-cache'
import SshConnectionError from '../../shared/errors/ssh-connection.error.js'
import Logger from '../../shared/logger.js'
import SshConnectionOpener from './ssh-connection.opener.js'
import type { ConnectRequest, SshConnection } from './ssh-connection.types.js'

const MAX_CONNECTIONS = 200
const IDLE_TIMEOUT_MS = 10 * 60 * 1000
const AUTH_FAILURE_COOLDOWN_MS = 60_000

interface ConnectionEntry {
  organizationId: string
  promise: Promise<SshConnection>
  // --> Set when the connection is ready, stays undefined while it is opening
  connection?: SshConnection
}

interface ManagerOptions {
  maxConnections?: number
  idleTimeoutMs?: number
  authFailureCooldownMs?: number
}

// --> Keeps one open SSH connection per server, never touches the database
export default class SshConnectionManager {
  private readonly logger = new Logger('SSH')
  private readonly opener = new SshConnectionOpener()
  private readonly connections: LRUCache<string, ConnectionEntry>
  private readonly authFailures: LRUCache<string, SshConnectionError>

  constructor({
    maxConnections = MAX_CONNECTIONS,
    idleTimeoutMs = IDLE_TIMEOUT_MS,
    authFailureCooldownMs = AUTH_FAILURE_COOLDOWN_MS,
  }: ManagerOptions = {}) {
    this.connections = new LRUCache<string, ConnectionEntry>({
      // --> over the limit, the least recently used connection is closed
      max: maxConnections,
      // --> idle timeout: every get() restarts it, the connection is closed when it runs out
      ttl: idleTimeoutMs,
      updateAgeOnGet: true,
      ttlAutopurge: true,
      // --> runs on every removal (idle, limit, close): end the SSH connection
      dispose: (entry, serverId, reason) => {
        this.logger.info('Connection closed', { serverId, reason })
        entry.promise.then(({ client }) => client.end()).catch(() => {})
      },
    })

    // --> servers that rejected our key, kept for a short time
    this.authFailures = new LRUCache<string, SshConnectionError>({
      max: 1000,
      ttl: authFailureCooldownMs,
    })
  }

  // --> Opens a connection and keeps it, returns the existing one when the server is already connected
  public async connect(request: ConnectRequest): Promise<SshConnection> {
    const { serverId, organizationId } = request

    // --> return the open connection, or the one being opened right now by another request
    const existing = this.connections.get(serverId)

    if (existing) {
      return existing.promise
    }

    // --> the key was rejected a moment ago: do not try again yet (repeated failures get our IP banned by fail2ban)
    const authFailure = this.authFailures.get(serverId)

    if (authFailure) {
      throw authFailure
    }

    // --> save the promise before waiting, so two requests at the same time open one connection only
    const entry: ConnectionEntry = {
      organizationId,
      promise: this.opener.open(request),
    }

    this.connections.set(serverId, entry)

    try {
      entry.connection = await entry.promise
    } catch (error) {
      // --> never keep a failed connection
      this.remove(serverId, entry)

      if (error instanceof SshConnectionError && error.code === 'SSH_AUTH_FAILED') {
        this.authFailures.set(serverId, error)
      }

      throw error
    }

    entry.connection.client.on('close', () => this.remove(serverId, entry))

    this.logger.info('Connected', {
      serverId,
      host: request.host,
      port: request.port,
    })

    return entry.connection
  }

  // --> The open connection of a server, undefined when there is none
  public async get(serverId: string): Promise<SshConnection | undefined> {
    const entry = this.connections.get(serverId)

    if (!entry) {
      return undefined
    }

    // --> a connection still opening is awaited, a failed one counts as "no connection"
    return entry.promise.catch(() => undefined)
  }

  // --> true only when the connection is ready (not while it is opening)
  public has(serverId: string): boolean {
    return this.connections.peek(serverId)?.connection !== undefined
  }

  // --> Servers of an organization with a ready connection, in this process only
  public getConnectedServerIds(organizationId: string): string[] {
    const serverIds: string[] = []

    for (const [serverId, entry] of this.connections.entries()) {
      if (entry.connection && entry.organizationId === organizationId) {
        serverIds.push(serverId)
      }
    }

    return serverIds
  }

  // --> Ready connections of this process, for background work (like reading the load of the servers)
  // reading them here does not count as a use: a connection nobody uses still closes when its idle time runs out
  public getOpenConnections(): { serverId: string; connection: SshConnection }[] {
    const open: { serverId: string; connection: SshConnection }[] = []

    for (const [serverId, entry] of this.connections.entries()) {
      if (entry.connection) {
        open.push({ serverId, connection: entry.connection })
      }
    }

    return open
  }

  // --> Call when a server is deleted or its host/username/key change
  public close(serverId: string): void {
    this.connections.delete(serverId)
    this.authFailures.delete(serverId)
  }

  // --> Call on shutdown
  public closeAll(): void {
    this.connections.clear()
    this.authFailures.clear()
  }

  // --> Removes an entry only if it is still the current one for this server
  private remove(serverId: string, entry: ConnectionEntry): void {
    if (this.connections.peek(serverId) === entry) {
      this.connections.delete(serverId)
    }
  }
}

// --> Single manager for the whole app
export const sshConnectionManager = new SshConnectionManager()
