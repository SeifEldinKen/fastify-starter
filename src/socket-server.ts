import type { Server as HttpServer } from 'node:http'
import { Server, type ServerOptions } from 'socket.io'
import type { SocketGateway } from './presentation/socket-gateway/base-socket.gateway.js'

// --> Owns the Socket.IO instance and the lifecycle of all gateways
export class SocketServer {
  private readonly io: Server

  constructor(
    httpServer: HttpServer,
    private readonly gateways: SocketGateway[],
    options: Partial<ServerOptions> = {},
  ) {
    // --> Attaches to the existing http.Server (Fastify's), no createServer needed
    this.io = new Server(httpServer, { cors: { origin: true }, ...options })

    for (const gateway of gateways) {
      gateway.bind(this.io)
    }
  }

  // --> Escape hatch for advanced use (adapters, global middlewares)
  public getIO(): Server {
    return this.io
  }

  // --> Shutdown step 1: open WebSockets would block http.Server.close() forever
  public disconnectAll(): void {
    this.io.local.disconnectSockets(true)
    for (const gateway of this.gateways) {
      gateway.disconnectAll()
    }
  }

  // --> Shutdown step 3 (after HTTP is closed): release the engine and adapters
  public async close(): Promise<void> {
    await this.io.close()
  }
}
