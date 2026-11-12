import type { RouteModule } from '../../http-server.js'
import { getAuthControllers } from './auth/index.js'
import { getHealthzControllers } from './healthz/index.js'

// --> Collects the controllers of all modules, passed to HttpServer routes in main.ts
export const getAllControllers = (): RouteModule[] => [
  /* Controllers */
  ...getHealthzControllers(),
  ...getAuthControllers(),
]
