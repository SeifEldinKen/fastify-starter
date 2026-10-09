import type { Server as HttpServer } from 'node:http'
import { createAdapter } from '@socket.io/redis-adapter'
import type { Redis } from 'ioredis'
import { type DefaultEventsMap, Server, type ServerOptions } from 'socket.io'
import { getRedisAdapterClients } from './infrastructure/redis/redis.js'
import type { SocketGateway } from './presentation/socket-gateway/socket.gateway.js'

export interface SocketData {
  userId?: string
}

type AppServer = Server<
  /*  */
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  SocketData
>

export interface SocketServerOptions {
  gateways: SocketGateway[]
  allowedOrigins?: string[]
  io?: Partial<ServerOptions>
  // --> Default from the Redis singleton, so initRedis() must run first
  adapterClients?: { pub: Redis; sub: Redis }
}

export class SocketServer {
  private readonly io: AppServer
  private readonly gateways: SocketGateway[]

  constructor(
    httpServer: HttpServer,
    { gateways, allowedOrigins, io, adapterClients = getRedisAdapterClients() }: SocketServerOptions,
  ) {
    this.gateways = gateways

    this.io = new Server(httpServer, {
      cors: {
        origin: allowedOrigins,
        credentials: true,
      },

      // --> Set at construction so every namespace starts on the Redis adapter.
      //     pub: publishes this instance's broadcasts to the others.
      //     sub: receives the other instances' broadcasts.
      //     Note: connectionStateRecovery is NOT supported by this adapter
      //     (use @socket.io/redis-streams-adapter if you need it).
      adapter: createAdapter(adapterClients.pub, adapterClients.sub, {
        key: 'socket.io',
      }),

      ...io,
    })

    for (const gateway of gateways) {
      gateway.bind(this.io)
    }
  }

  // --> Escape hatch for advanced use (global middlewares, serverSideEmit, ...)
  public getIO(): AppServer {
    return this.io
  }

  // --> Shutdown step 1: open WebSockets would block http.Server.close() forever.
  //     Disconnects THIS instance's sockets only (clients reconnect to another instance)
  //     and waits for their presence cleanup to reach Redis.
  public async disconnectAll(): Promise<void> {
    this.io.local.disconnectSockets(true)
    await Promise.all(this.gateways.map((gateway) => gateway.disconnectAll()))
  }

  // --> Shutdown step 3 (after HTTP is closed): releases the engine and unsubscribes
  //     the adapters from Redis, so Redis must still be connected at this point
  public async close(): Promise<void> {
    await this.io.close()
  }
}
