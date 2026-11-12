import type { RouteModule } from '../../../http-server.js'
import ServersController from './servers.controller.js'

// --> Register every controller of the servers module here
export const getServersControllers = (): RouteModule[] => [
  /* Controllers */
  new ServersController().toRouteModule(),
]
