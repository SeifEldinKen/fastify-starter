import type { Readable } from 'node:stream'
import type { FileEntryWithStats, SFTPWrapper, Stats } from 'ssh2'
import FileError from '../../shared/errors/file.error.js'
import NotFoundError from '../../shared/errors/not-found.error.js'

// --> Status codes of the SFTP protocol
const END_OF_FILE = 1
const NO_SUCH_FILE = 2
const PERMISSION_DENIED = 3

export interface ListedDirectory {
  entries: FileEntryWithStats[]
  // --> true when the folder holds more entries than the limit, the rest was not read
  isTruncated: boolean
}

// --> File operations over the SFTP channel of a connection, as promises
// SFTP runs as the Linux account of the connection: the server itself refuses what that account cannot do.
// no shell is involved, a path is sent as data and can never be read as a command
export default class SftpFiles {
  constructor(private readonly sftp: SFTPWrapper) {}

  // --> The real absolute path: "." is the home folder of the account, links and ".." are followed
  public realPath(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.sftp.realpath(path, (error, absolutePath) =>
        error ? reject(this.toError(error, path)) : resolve(absolutePath),
      )
    })
  }

  // --> Details of what a path points to, a link is followed
  public stat(path: string): Promise<Stats> {
    return new Promise((resolve, reject) => {
      this.sftp.stat(path, (error, stats) => (error ? reject(this.toError(error, path)) : resolve(stats)))
    })
  }

  // --> Details of the path itself: for a link, the link and not its target
  public lstat(path: string): Promise<Stats> {
    return new Promise((resolve, reject) => {
      this.sftp.lstat(path, (error, stats) => (error ? reject(this.toError(error, path)) : resolve(stats)))
    })
  }

  public async exists(path: string): Promise<boolean> {
    return this.lstat(path).then(
      () => true,
      (error: unknown) => {
        if (error instanceof NotFoundError) {
          return false
        }

        throw error
      },
    )
  }

  // --> Where a link points to
  public readLink(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.sftp.readlink(path, (error, target) => (error ? reject(this.toError(error, path)) : resolve(target)))
    })
  }

  // --> Entries of a folder, read in parts: a folder with a million files is never read whole
  public list(path: string, limit: number): Promise<ListedDirectory> {
    return new Promise((resolve, reject) => {
      this.sftp.opendir(path, (openError, handle) => {
        if (openError) {
          reject(this.toError(openError, path))
          return
        }

        const entries: FileEntryWithStats[] = []

        const finish = (error: Error | undefined, isTruncated: boolean) => {
          // --> always give the handle back to the server
          this.sftp.close(handle, () => {
            if (error) {
              reject(this.toError(error, path))
            } else {
              resolve({ entries: entries.slice(0, limit), isTruncated })
            }
          })
        }

        const readNext = () => {
          this.sftp.readdir(handle, (error, list) => {
            // --> the server answers "end of file" when the folder has no more entries: this is the normal end
            if ((error as (Error & { code?: unknown }) | undefined)?.code === END_OF_FILE) {
              finish(undefined, false)
              return
            }

            if (error) {
              finish(error, false)
              return
            }

            entries.push(...list.filter((entry) => entry.filename !== '.' && entry.filename !== '..'))

            if (entries.length > limit) {
              finish(undefined, true)
              return
            }

            readNext()
          })
        }

        readNext()
      })
    })
  }

  // --> The parent must exist, the rights of the new folder come from the settings of the account (umask)
  public makeDirectory(path: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.sftp.mkdir(path, (error) => (error ? reject(this.toError(error, path)) : resolve()))
    })
  }

  // --> "wx": the file is created, never replaced. The server refuses when the path already exists
  public createFile(path: string, content: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      this.sftp.writeFile(path, content, { flag: 'wx' }, (error) =>
        error ? reject(this.toError(error, path)) : resolve(),
      )
    })
  }

  public changeMode(path: string, mode: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.sftp.chmod(path, mode, (error) => (error ? reject(this.toError(error, path)) : resolve()))
    })
  }

  // --> Reads a file up to a limit, null when it is bigger: the size a server reports cannot be trusted for every file
  public read(path: string, maxBytes: number): Promise<Buffer | null> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      let size = 0

      // --> "end" is included: one byte more than the limit is asked, to know when the file is bigger
      const stream = this.sftp.createReadStream(path, { start: 0, end: maxBytes })

      stream.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
        size += chunk.length
      })

      stream.on('error', (error: Error) => reject(this.toError(error, path)))
      stream.on('end', () => resolve(size > maxBytes ? null : Buffer.concat(chunks)))
    })
  }

  // --> The content of a file as a stream, sent to the client part by part: the file is never whole in memory
  public createReadStream(path: string): Readable {
    return this.sftp.createReadStream(path)
  }

  // --> Turns an error of the SFTP protocol into the error the client sees
  private toError(error: Error & { code?: unknown }, path: string): Error {
    if (error.code === NO_SUCH_FILE) {
      return new NotFoundError(`"${path}" does not exist on the server`)
    }

    if (error.code === PERMISSION_DENIED) {
      return new FileError(
        'FILE_PERMISSION_DENIED',
        `The account used to connect to this server has no right to do this on "${path}"`,
        { cause: error },
      )
    }

    return new FileError('FILE_OPERATION_FAILED', `The server refused the operation on "${path}"`, { cause: error })
  }
}
