import { posix } from 'node:path'
import type { Readable } from 'node:stream'
import GetServerConnectionUseCase from '@/domain/use-cases/ssh/get-server-connection.usecase.js'
import SftpFiles from '@/infrastructure/ssh/sftp-files.js'
import FileError from '@/shared/errors/file.error.js'
import { assertReadablePath, toCleanPath } from './file.rules.js'

interface DownloadFileRequest {
  // --> EnsurePermissionHook already checked it belongs to the organization and the member can access it
  serverId: string
  path: string
}

interface DownloadFileResponse {
  name: string
  // --> The size the server reports, 0 for the files whose size it does not know
  size: number
  // --> Read part by part while it is sent: the file is never whole in the memory of the app
  stream: Readable
}

// --> A file of a server as a stream, of any size and any kind
export default class DownloadFileUseCase {
  constructor(private readonly getServerConnection: GetServerConnectionUseCase = new GetServerConnectionUseCase()) {}

  public async execute({ serverId, path }: DownloadFileRequest): Promise<DownloadFileResponse> {
    const cleanPath = toCleanPath(path)

    // --> a secret path is refused before the server is asked anything about it
    assertReadablePath(cleanPath)

    // --> get the connection of the server
    const connection = await this.getServerConnection.execute({ serverId })
    const files = new SftpFiles(connection.sftp)

    // --> find the real file, links are followed: a link to a secret file is refused like the file itself
    const realPath = await files.realPath(cleanPath)

    assertReadablePath(realPath)

    const stats = await files.stat(realPath)

    if (!stats.isFile()) {
      throw new FileError('FILE_NOT_A_FILE', `"${realPath}" is not a file`)
    }

    return {
      // --> the name the client asked for: a link keeps its own name, not the one of its target
      name: posix.basename(cleanPath),
      size: stats.size,
      stream: files.createReadStream(realPath),
    }
  }
}
