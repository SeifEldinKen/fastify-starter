import type { RouteModule } from '../../../http-server.js'
import ServicesController from './services.controller.js'

// --> Register every controller of the services module here
export const getServicesControllers = (): RouteModule[] => [
  /* Controllers */
  new ServicesController().toRouteModule(),
]
