import type { RouteModule } from '../../http-server.js'
import { getAuthControllers } from './auth/index.js'
import { getHealthzControllers } from './healthz/index.js'
import { getOrganizationsControllers } from './organizations/index.js'
import { getServersControllers } from './servers/index.js'
import { getServicesControllers } from './services/index.js'
import { getSystemUsersControllers } from './system-users/index.js'

// --> Collects the controllers of all modules, passed to HttpServer routes in main.ts
export const getAllControllers = (): RouteModule[] => [
  /* Controllers */
  ...getHealthzControllers(),
  ...getAuthControllers(),
  ...getOrganizationsControllers(),
  ...getServersControllers(),
  ...getSystemUsersControllers(),
  ...getServicesControllers(),
]
