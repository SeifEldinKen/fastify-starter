import GetServerConnectionUseCase from '@/domain/use-cases/ssh/get-server-connection.usecase.js'
import type { PrismaClient } from '@/generated/prisma/client.js'
import { prismaDb } from '@/infrastructure/database/prisma.js'
import SftpFiles from '@/infrastructure/ssh/sftp-files.js'
import ValidationError from '@/shared/errors/validation.error.js'
import {
  assertWritablePath,
  FILE_MODE_PATTERN,
  type FileEntry,
  toCleanPath,
  toFileEntry,
  toMode,
} from './file.rules.js'

interface ChangeFilePermissionsRequest {
  // --> From request.user and the route, both already checked by the hooks
  userId: string
  organizationId: string
  serverId: string
  path: string
  // --> "644", "755" ...
  mode: string
}

// --> Changes the rights of one file or folder (chmod), not of what a folder holds
// only the owner of a file can change its rights, or root
export default class ChangeFilePermissionsUseCase {
  constructor(
    private readonly db: PrismaClient = prismaDb,
    private readonly getServerConnection: GetServerConnectionUseCase = new GetServerConnectionUseCase(),
  ) {}

  public async execute(request: ChangeFilePermissionsRequest): Promise<FileEntry> {
    const { userId, organizationId, serverId, path, mode } = request

    if (!FILE_MODE_PATTERN.test(mode)) {
      throw new ValidationError('The mode must be three or four digits from 0 to 7, like "644"')
    }

    const cleanPath = toCleanPath(path)

    // --> a locked place is refused before the server is asked anything about it
    assertWritablePath(cleanPath)

    // --> get the connection of the server
    const connection = await this.getServerConnection.execute({ serverId })
    const files = new SftpFiles(connection.sftp)

    // --> find the real path: the rights of a link are the ones of its target
    const realPath = await files.realPath(cleanPath)

    assertWritablePath(realPath)

    // --> change the rights
    const previousMode = toMode(await files.stat(realPath))

    await files.changeMode(realPath, Number.parseInt(mode, 8))

    // --> save who changed it
    await this.db.auditLog.create({
      data: {
        organizationId,
        userId,
        serverId,
        action: 'file.permissions.change',
        metadata: { path: realPath, from: previousMode, to: mode },
      },
    })

    // --> read it back from the server: the response shows what really exists there
    return toFileEntry({ path: realPath, stats: await files.stat(realPath) })
  }
}
