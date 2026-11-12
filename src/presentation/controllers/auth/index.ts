import type { RouteModule } from '../../../http-server.js'
import AuthController from './auth.controller.js'

// --> Register every controller of the auth module here
export const getAuthControllers = (): RouteModule[] => [
  /* Controllers */
  new AuthController().toRouteModule(),
]
