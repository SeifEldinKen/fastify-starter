import type { RouteModule } from '../../../http-server.js'
import FirewallController from './firewall.controller.js'

// --> Register every controller of the firewall module here
export const getFirewallControllers = (): RouteModule[] => [
  /* Controllers */
  new FirewallController().toRouteModule(),
]
