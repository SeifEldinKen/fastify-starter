import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import ChangeFilePermissionsUseCase from '@/domain/use-cases/files/change-file-permissions.usecase.js'
import CreateDirectoryUseCase from '@/domain/use-cases/files/create-directory.usecase.js'
import CreateFileUseCase from '@/domain/use-cases/files/create-file.usecase.js'
import DownloadFileUseCase from '@/domain/use-cases/files/download-file.usecase.js'
import ListDirectoryUseCase from '@/domain/use-cases/files/list-directory.usecase.js'
import ReadFileUseCase from '@/domain/use-cases/files/read-file.usecase.js'
import EnsureAuthenticateHook from '../../hooks/ensure-authenticate.hook.js'
import EnsurePermissionHook from '../../hooks/ensure-permission.hook.js'
import BaseController from '../base.controller.js'
import {
  type ChangeFilePermissionsBody,
  type CreateDirectoryBody,
  type CreateFileBody,
  changeFilePermissionsSchema,
  createDirectorySchema,
  createFileSchema,
  downloadFileSchema,
  type FilePathQuery,
  type ListDirectoryQuery,
  listDirectorySchema,
  readFileSchema,
  type ServerParams,
} from './files.schemas.js'

export default class FilesController extends BaseController {
  protected readonly prefix = '/organizations/:organizationId/servers/:serverId/files'

  constructor(
    private readonly listDirectoryUseCase: ListDirectoryUseCase = new ListDirectoryUseCase(),
    private readonly readFileUseCase: ReadFileUseCase = new ReadFileUseCase(),
    private readonly downloadFileUseCase: DownloadFileUseCase = new DownloadFileUseCase(),
    private readonly createDirectoryUseCase: CreateDirectoryUseCase = new CreateDirectoryUseCase(),
    private readonly createFileUseCase: CreateFileUseCase = new CreateFileUseCase(),
    private readonly changeFilePermissionsUseCase: ChangeFilePermissionsUseCase = new ChangeFilePermissionsUseCase(),
  ) {
    super()
  }

  protected registerRoutes(app: FastifyInstance): void {
    /* GET */
    app.get<{ Params: ServerParams; Querystring: ListDirectoryQuery }>('/', {
      schema: listDirectorySchema,
      handler: this.list.bind(this),
      onRequest: [
        /* Middlewares */
        new EnsureAuthenticateHook().handler(),
        new EnsurePermissionHook().require({ organization: ['file:view'] }),
      ],
    })

    app.get<{ Params: ServerParams; Querystring: FilePathQuery }>('/content', {
      schema: readFileSchema,
      handler: this.read.bind(this),
      onRequest: [
        /* Middlewares */
        new EnsureAuthenticateHook().handler(),
        new EnsurePermissionHook().require({ organization: ['file:view'] }),
      ],
    })

    app.get<{ Params: ServerParams; Querystring: FilePathQuery }>('/download', {
      schema: downloadFileSchema,
      handler: this.download.bind(this),
      onRequest: [
        /* Middlewares */
        new EnsureAuthenticateHook().handler(),
        new EnsurePermissionHook().require({ organization: ['file:view'] }),
      ],
    })

    /* POST */
    app.post<{ Params: ServerParams; Body: CreateFileBody }>('/', {
      schema: createFileSchema,
      handler: this.createFile.bind(this),
      onRequest: [
        /* Middlewares */
        new EnsureAuthenticateHook().handler(),
        new EnsurePermissionHook().require({ organization: ['file:create'] }),
      ],
    })

    app.post<{ Params: ServerParams; Body: CreateDirectoryBody }>('/directories', {
      schema: createDirectorySchema,
      handler: this.createDirectory.bind(this),
      onRequest: [
        /* Middlewares */
        new EnsureAuthenticateHook().handler(),
        new EnsurePermissionHook().require({ organization: ['file:create'] }),
      ],
    })

    /* PATCH */
    app.patch<{ Params: ServerParams; Body: ChangeFilePermissionsBody }>('/permissions', {
      schema: changeFilePermissionsSchema,
      handler: this.changePermissions.bind(this),
      onRequest: [
        /* Middlewares */
        new EnsureAuthenticateHook().handler(),
        new EnsurePermissionHook().require({ organization: ['file:update'] }),
      ],
    })
  }

  private async list(
    request: FastifyRequest<{ Params: ServerParams; Querystring: ListDirectoryQuery }>,
    reply: FastifyReply,
  ) {
    const directory = await this.listDirectoryUseCase.execute({
      serverId: request.params.serverId,
      path: request.query.path,
    })

    return this.ok(reply, directory)
  }

  private async read(
    request: FastifyRequest<{ Params: ServerParams; Querystring: FilePathQuery }>,
    reply: FastifyReply,
  ) {
    const file = await this.readFileUseCase.execute({
      serverId: request.params.serverId,
      path: request.query.path,
    })

    return this.ok(reply, file)
  }

  private async download(
    request: FastifyRequest<{ Params: ServerParams; Querystring: FilePathQuery }>,
    reply: FastifyReply,
  ) {
    const file = await this.downloadFileUseCase.execute({
      serverId: request.params.serverId,
      path: request.query.path,
    })

    // --> "attachment": the browser saves the file, it never opens it as a page of this site
    reply.header('Content-Type', 'application/octet-stream')
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`)
    reply.header('X-Content-Type-Options', 'nosniff')

    return reply.send(file.stream)
  }

  private async createFile(
    request: FastifyRequest<{ Params: ServerParams; Body: CreateFileBody }>,
    reply: FastifyReply,
  ) {
    const file = await this.createFileUseCase.execute({
      ...request.body,
      userId: request.user.userId,
      organizationId: request.params.organizationId,
      serverId: request.params.serverId,
    })

    return this.created(reply, file)
  }

  private async createDirectory(
    request: FastifyRequest<{ Params: ServerParams; Body: CreateDirectoryBody }>,
    reply: FastifyReply,
  ) {
    const directory = await this.createDirectoryUseCase.execute({
      ...request.body,
      userId: request.user.userId,
      organizationId: request.params.organizationId,
      serverId: request.params.serverId,
    })

    return this.created(reply, directory)
  }

  private async changePermissions(
    request: FastifyRequest<{ Params: ServerParams; Body: ChangeFilePermissionsBody }>,
    reply: FastifyReply,
  ) {
    const file = await this.changeFilePermissionsUseCase.execute({
      ...request.body,
      userId: request.user.userId,
      organizationId: request.params.organizationId,
      serverId: request.params.serverId,
    })

    return this.ok(reply, file)
  }
}
