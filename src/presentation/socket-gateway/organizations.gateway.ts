import type { Socket } from 'socket.io'
import { SocketGateway } from './socket.gateway.js'

export default class OrganizationsGateway extends SocketGateway {
  readonly namespace = '/organizations'

  protected onConnection(_socket: Socket): void {}
}
