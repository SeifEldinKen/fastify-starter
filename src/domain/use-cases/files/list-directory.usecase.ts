import { posix } from 'node:path'
import GetServerConnectionUseCase from '@/domain/use-cases/ssh/get-server-connection.usecase.js'
import SftpFiles from '@/infrastructure/ssh/sftp-files.js'
import FileError from '@/shared/errors/file.error.js'
import { type FileEntry, toCleanPath, toFileEntry, toFileType } from './file.rules.js'

// --> A folder with more entries is cut, the client is told: nobody browses that many files in a list
export const MAX_DIRECTORY_ENTRIES = 1000

interface ListDirectoryRequest {
  // --> EnsurePermissionHook already checked it belongs to the organization and the member can access it
  serverId: string
  // --> Absolute path, undefined for the home folder of the account used to connect
  path?: string | undefined
}

interface ListDirectoryResponse {
  // --> The real path of the folder, after links and ".." are followed
  path: string
  // --> null for "/"
  parent: string | null
  total: number
  // --> true when the folder holds more than the limit, the rest is not returned
  isTruncated: boolean
  entries: FileEntry[]
}

// --> What a folder of a server holds, as the Linux account of the connection sees it
export default class ListDirectoryUseCase {
  constructor(private readonly getServerConnection: GetServerConnectionUseCase = new GetServerConnectionUseCase()) {}

  public async execute({ serverId, path }: ListDirectoryRequest): Promise<ListDirectoryResponse> {
    // --> get the connection of the server
    const connection = await this.getServerConnection.execute({ serverId })
    const files = new SftpFiles(connection.sftp)

    // --> find the real folder: "." is the home folder of the account
    const directory = await files.realPath(path === undefined ? '.' : toCleanPath(path))
    const stats = await files.stat(directory)

    if (!stats.isDirectory()) {
      throw new FileError('FILE_NOT_A_DIRECTORY', `"${directory}" is not a folder`)
    }

    // --> read the entries of the folder
    const { entries: listed, isTruncated } = await files.list(directory, MAX_DIRECTORY_ENTRIES)

    const entries = await Promise.all(
      listed.map(async ({ filename, longname, attrs }) => {
        const entryPath = posix.join(directory, filename)

        // --> the server sends a line like "ls -l": "-rw-r--r-- 1 owner group size date name", the only place with names
        const [, , owner = null, group = null] = longname.trim().split(/\s+/)

        // --> for a link: where it points to, and what is there. A link can point to nothing
        const link = attrs.isSymbolicLink()
          ? {
              target: await files.readLink(entryPath).catch(() => ''),
              type: await files.stat(entryPath).then(toFileType, () => 'missing' as const),
            }
          : null

        return toFileEntry({ path: entryPath, stats: attrs, owner, group, link })
      }),
    )

    // --> folders first (and links to folders), then by name
    const isFolder = (entry: FileEntry) => entry.type === 'directory' || entry.link?.type === 'directory'

    entries.sort((first, second) => {
      const byKind = Number(isFolder(second)) - Number(isFolder(first))

      return byKind !== 0 ? byKind : first.name.localeCompare(second.name)
    })

    return {
      path: directory,
      parent: directory === '/' ? null : posix.dirname(directory),
      total: entries.length,
      isTruncated,
      entries,
    }
  }
}
