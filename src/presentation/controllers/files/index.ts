import type { RouteModule } from '../../../http-server.js'
import FilesController from './files.controller.js'

// --> Register every controller of the files module here
export const getFilesControllers = (): RouteModule[] => [
  /* Controllers */
  new FilesController().toRouteModule(),
]
