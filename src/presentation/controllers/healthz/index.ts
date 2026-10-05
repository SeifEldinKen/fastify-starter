import type { RouteModule } from '../../../http-server.js'
import HealthzController from './healthz.controller.js'

// --> Register every controller of the healthz module here
export const getHealthzControllers = (): RouteModule[] => [
  /* Controllers */
  new HealthzController().toRouteModule(),
]
