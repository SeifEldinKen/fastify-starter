import { posix } from 'node:path'
import type { Stats } from 'ssh2'
import FileError from '@/shared/errors/file.error.js'
import ValidationError from '@/shared/errors/validation.error.js'

export const MAX_PATH_LENGTH = 4096
export const MAX_NAME_LENGTH = 255

// --> Biggest text file read or created through the panel, bigger files are downloaded
export const MAX_TEXT_FILE_BYTES = 1024 * 1024

// --> Three or four digits from 0 to 7: "644", "755", "2775"
export const FILE_MODE_PATTERN = /^[0-7]{3,4}$/

export type FileType = 'file' | 'directory' | 'symlink' | 'other'

export interface FileEntry {
  name: string
  path: string
  type: FileType
  size: number
  // --> "644"
  mode: string
  // --> "rw-r--r--"
  permissions: string
  ownerId: number
  groupId: number
  // --> Names are only known when a folder is listed, null otherwise
  owner: string | null
  group: string | null
  modifiedAt: string
  // --> For a link: where it points to, and what is there. null when it is not a link
  link: { target: string; type: FileType | 'missing' } | null
}

// --> A path sent by the client: absolute, and cleaned from "..", "." and double "/"
// SFTP sends a path as data, so no character is dangerous by itself: this only keeps paths readable and comparable
export const toCleanPath = (path: string): string => {
  if (path.length > MAX_PATH_LENGTH || /\p{Cc}/u.test(path)) {
    throw new ValidationError('The path is too long or holds control characters')
  }

  if (!path.startsWith('/')) {
    throw new ValidationError('The path must be absolute, it starts with "/"')
  }

  const clean = posix.normalize(path)

  // --> "/var/www/" and "/var/www" are the same folder
  return clean.length > 1 && clean.endsWith('/') ? clean.slice(0, -1) : clean
}

// --> The name of a new file or folder: one part of a path, never "." or ".."
export const assertValidName = (name: string): void => {
  if (name === '' || name === '.' || name === '..' || name.length > MAX_NAME_LENGTH || name.includes('/')) {
    throw new ValidationError('Not a valid file or folder name')
  }
}

// --> Files the panel never reads, whatever the account can do: private keys and password hashes
// the check is made on the real path, after links are followed: a link to one of them is refused too
const isSecretPath = (path: string): boolean => {
  const name = posix.basename(path)
  const folder = posix.basename(posix.dirname(path))

  return (
    // --> private SSH keys of a user: ~/.ssh/id_ed25519 ..., the public half (.pub) is not a secret
    (folder === '.ssh' && name.startsWith('id_') && !name.endsWith('.pub')) ||
    // --> private keys of the server itself
    (posix.dirname(path) === '/etc/ssh' && /^ssh_host_.*_key$/.test(name)) ||
    // --> password hashes
    /^\/etc\/g?shadow-?$/.test(path)
  )
}

// --> Places the panel never writes to: a change there gives a direct way into the server, or root rights
// this is a short list of the obvious doors, not a wall: a member who can write files as the account
// can reach what that account can reach
const isLockedPath = (path: string): boolean => {
  const parts = path.split('/')

  return (
    // --> the keys allowed to log in as a user, and its own keys
    parts.includes('.ssh') ||
    /^\/etc\/(ssh|sudoers\.d)(\/|$)/.test(path) ||
    /^\/etc\/(sudoers|passwd|group|g?shadow-?)$/.test(path)
  )
}

export const assertReadablePath = (realPath: string): void => {
  if (isSecretPath(realPath)) {
    throw new FileError(
      'FILE_PATH_PROTECTED',
      'This file holds a private key or password hashes, the panel never reads it',
    )
  }
}

export const assertWritablePath = (realPath: string): void => {
  if (isLockedPath(realPath)) {
    throw new FileError(
      'FILE_PATH_PROTECTED',
      'The panel never changes this place: it controls who can enter the server',
    )
  }
}

export const toFileType = (stats: Stats): FileType => {
  if (stats.isSymbolicLink()) {
    return 'symlink'
  }

  if (stats.isDirectory()) {
    return 'directory'
  }

  return stats.isFile() ? 'file' : 'other'
}

// --> The last four digits of the mode: "644", or "2775" when a special bit is set
export const toMode = (stats: Stats): string => {
  const mode = (stats.mode & 0o7777).toString(8)

  return mode.padStart(3, '0')
}

// --> "rw-r--r--", with the special bits written like ls does: s, S, t, T
export const toPermissions = (stats: Stats): string => {
  const { mode } = stats
  const letters = [...'rwxrwxrwx'].map((letter, index) => (mode & (0o400 >> index) ? letter : '-'))

  const special: [bit: number, position: number, letter: string][] = [
    [0o4000, 2, 's'],
    [0o2000, 5, 's'],
    [0o1000, 8, 't'],
  ]

  for (const [bit, position, letter] of special) {
    if (mode & bit) {
      letters[position] = letters[position] === 'x' ? letter : letter.toUpperCase()
    }
  }

  return letters.join('')
}

interface ToFileEntryRequest {
  path: string
  stats: Stats
  owner?: string | null
  group?: string | null
  link?: FileEntry['link']
}

export const toFileEntry = ({
  path,
  stats,
  owner = null,
  group = null,
  link = null,
}: ToFileEntryRequest): FileEntry => {
  return {
    name: path === '/' ? '/' : posix.basename(path),
    path,
    type: toFileType(stats),
    size: stats.size,
    mode: toMode(stats),
    permissions: toPermissions(stats),
    ownerId: stats.uid,
    groupId: stats.gid,
    owner,
    group,
    modifiedAt: new Date(stats.mtime * 1000).toISOString(),
    link,
  }
}
