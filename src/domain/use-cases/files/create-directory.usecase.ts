import { posix } from 'node:path'
import GetServerConnectionUseCase from '@/domain/use-cases/ssh/get-server-connection.usecase.js'
import type { PrismaClient } from '@/generated/prisma/client.js'
import { prismaDb } from '@/infrastructure/database/prisma.js'
import SftpFiles from '@/infrastructure/ssh/sftp-files.js'
import ConflictError from '@/shared/errors/conflict.error.js'
import { assertValidName, assertWritablePath, type FileEntry, toCleanPath, toFileEntry } from './file.rules.js'

interface CreateDirectoryRequest {
  // --> From request.user and the route, both already checked by the hooks
  userId: string
  organizationId: string
  serverId: string
  // --> Absolute path of the new folder, its parent must exist
  path: string
}

// --> Creates one folder on a server, as the Linux account of the connection
export default class CreateDirectoryUseCase {
  constructor(
    private readonly db: PrismaClient = prismaDb,
    private readonly getServerConnection: GetServerConnectionUseCase = new GetServerConnectionUseCase(),
  ) {}

  public async execute({ userId, organizationId, serverId, path }: CreateDirectoryRequest): Promise<FileEntry> {
    const cleanPath = toCleanPath(path)
    const name = posix.basename(cleanPath)

    assertValidName(name)

    // --> a locked place is refused before the server is asked anything about it
    assertWritablePath(cleanPath)

    // --> get the connection of the server
    const connection = await this.getServerConnection.execute({ serverId })
    const files = new SftpFiles(connection.sftp)

    // --> find the real parent, links are followed: a link into a locked place is refused like the place itself
    const directory = posix.join(await files.realPath(posix.dirname(cleanPath)), name)

    assertWritablePath(directory)

    // --> check if something is already there
    if (await files.exists(directory)) {
      throw new ConflictError('FILE_ALREADY_EXISTS', `"${directory}" already exists`)
    }

    // --> create directory
    await files.makeDirectory(directory)

    // --> save who created it
    await this.db.auditLog.create({
      data: {
        organizationId,
        userId,
        serverId,
        action: 'file.directory.create',
        metadata: { path: directory },
      },
    })

    // --> read it back from the server: the response shows what really exists there
    return toFileEntry({ path: directory, stats: await files.lstat(directory) })
  }
}
