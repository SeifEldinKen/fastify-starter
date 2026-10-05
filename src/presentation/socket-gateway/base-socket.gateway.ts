import type { Namespace, Server, Socket } from 'socket.io'

export type NextFn = (err?: Error) => void

// --> Base class for every real-time feature. Each gateway owns one namespace.
export abstract class SocketGateway {
  abstract readonly namespace: string

  private nsp: Namespace | undefined

  // --> Called once by SocketServer, wires the namespace to this gateway's methods
  bind(io: Server): void {
    if (this.nsp) {
      throw new Error(`${this.constructor.name} is already bound`)
    }

    this.nsp = io.of(this.namespace)

    /* Authentication middleware */
    this.nsp.use((socket, next) => this.authenticate(socket, next))

    /* Connect */
    this.nsp.on('connection', (socket) => {
      const { userId } = socket.data

      /* Set personal room for this user (set socket.data.userId in authenticate) */
      if (userId) {
        socket.join(`userId:${userId}`)
      }

      /* Disconnect */
      socket.on('disconnect', (reason) => this.onDisconnect(socket, reason))
      this.onConnection(socket)
    })
  }

  // --> Override to protect the namespace (default: allow everyone)
  protected authenticate(_socket: Socket, next: NextFn): void {
    next()
  }

  protected abstract onConnection(socket: Socket): void

  protected onDisconnect(_socket: Socket, _reason: string): void {
    /* Implement */
  }

  // --> Safe access to the namespace for subclasses: this.server.to(room).emit(...)
  protected get server(): Namespace {
    if (!this.nsp) throw new Error(`${this.constructor.name} is not bound yet`)
    return this.nsp
  }

  disconnectAll(): void {
    this.nsp?.local.disconnectSockets(true)
  }
}
