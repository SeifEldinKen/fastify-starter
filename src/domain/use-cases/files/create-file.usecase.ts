import { posix } from 'node:path'
import GetServerConnectionUseCase from '@/domain/use-cases/ssh/get-server-connection.usecase.js'
import type { PrismaClient } from '@/generated/prisma/client.js'
import { prismaDb } from '@/infrastructure/database/prisma.js'
import SftpFiles from '@/infrastructure/ssh/sftp-files.js'
import ConflictError from '@/shared/errors/conflict.error.js'
import ValidationError from '@/shared/errors/validation.error.js'
import {
  assertValidName,
  assertWritablePath,
  type FileEntry,
  MAX_TEXT_FILE_BYTES,
  toCleanPath,
  toFileEntry,
} from './file.rules.js'

interface CreateFileRequest {
  // --> From request.user and the route, both already checked by the hooks
  userId: string
  organizationId: string
  serverId: string
  // --> Absolute path of the new file, its folder must exist
  path: string
  // --> Text, empty for an empty file. Never written to the audit log
  content: string
}

// --> Creates one text file on a server, as the Linux account of the connection. An existing file is never replaced
export default class CreateFileUseCase {
  constructor(
    private readonly db: PrismaClient = prismaDb,
    private readonly getServerConnection: GetServerConnectionUseCase = new GetServerConnectionUseCase(),
  ) {}

  public async execute({ userId, organizationId, serverId, path, content }: CreateFileRequest): Promise<FileEntry> {
    const cleanPath = toCleanPath(path)
    const name = posix.basename(cleanPath)

    assertValidName(name)

    // --> a locked place is refused before the server is asked anything about it
    assertWritablePath(cleanPath)

    const bytes = Buffer.from(content, 'utf8')

    if (bytes.length > MAX_TEXT_FILE_BYTES) {
      throw new ValidationError('The content is too big, upload the file instead')
    }

    // --> get the connection of the server
    const connection = await this.getServerConnection.execute({ serverId })
    const files = new SftpFiles(connection.sftp)

    // --> find the real folder, links are followed: a link into a locked place is refused like the place itself
    const file = posix.join(await files.realPath(posix.dirname(cleanPath)), name)

    assertWritablePath(file)

    // --> check if something is already there
    if (await files.exists(file)) {
      throw new ConflictError('FILE_ALREADY_EXISTS', `"${file}" already exists`)
    }

    // --> create file
    await files.createFile(file, bytes)

    // --> save who created it, without its content
    await this.db.auditLog.create({
      data: {
        organizationId,
        userId,
        serverId,
        action: 'file.create',
        metadata: { path: file, size: bytes.length },
      },
    })

    // --> read it back from the server: the response shows what really exists there
    return toFileEntry({ path: file, stats: await files.lstat(file) })
  }
}
