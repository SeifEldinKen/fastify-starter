import type { RouteModule } from '../../../http-server.js'
import SystemUsersController from './system-users.controller.js'

// --> Register every controller of the system users module here
export const getSystemUsersControllers = (): RouteModule[] => [
  /* Controllers */
  new SystemUsersController().toRouteModule(),
]
