import type { RouteModule } from '../../../http-server.js'
import OrganizationsController from './organizations.controller.js'

// --> Register every controller of the organizations module here
export const getOrganizationsControllers = (): RouteModule[] => [
  /* Controllers */
  new OrganizationsController().toRouteModule(),
]
