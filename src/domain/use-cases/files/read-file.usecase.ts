import GetServerConnectionUseCase from '@/domain/use-cases/ssh/get-server-connection.usecase.js'
import SftpFiles from '@/infrastructure/ssh/sftp-files.js'
import FileError from '@/shared/errors/file.error.js'
import { assertReadablePath, type FileEntry, MAX_TEXT_FILE_BYTES, toCleanPath, toFileEntry } from './file.rules.js'

interface ReadFileRequest {
  // --> EnsurePermissionHook already checked it belongs to the organization and the member can access it
  serverId: string
  path: string
}

type ReadFileResponse = FileEntry & {
  content: string
}

// --> The content of a text file of a server, to show or edit it. Bigger or binary files are downloaded
export default class ReadFileUseCase {
  constructor(private readonly getServerConnection: GetServerConnectionUseCase = new GetServerConnectionUseCase()) {}

  public async execute({ serverId, path }: ReadFileRequest): Promise<ReadFileResponse> {
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

    // --> read the file, up to the limit: some files report a size of 0 and still hold content
    const content = stats.size > MAX_TEXT_FILE_BYTES ? null : await files.read(realPath, MAX_TEXT_FILE_BYTES)

    if (content === null) {
      throw new FileError('FILE_TOO_LARGE', 'This file is too big to be shown, download it instead')
    }

    return {
      ...toFileEntry({ path: realPath, stats }),
      content: this.toText(content),
    }
  }

  // --> A file with a zero byte, or that is not valid UTF-8, is not text
  private toText(content: Buffer): string {
    if (content.includes(0)) {
      throw new FileError('FILE_NOT_TEXT', 'This file is not a text file, download it instead')
    }

    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(content)
    } catch {
      throw new FileError('FILE_NOT_TEXT', 'This file is not a text file, download it instead')
    }
  }
}
