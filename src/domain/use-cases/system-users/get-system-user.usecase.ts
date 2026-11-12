import { createHash } from 'node:crypto'
import GetServerConnectionUseCase from '@/domain/use-cases/ssh/get-server-connection.usecase.js'
import { DETECT_SUDO } from '@/infrastructure/ssh/scripts/sudo.script.js'
import type SshCommandRunner from '@/infrastructure/ssh/ssh-command.runner.js'
import { sshCommandRunner } from '@/infrastructure/ssh/ssh-command.runner.js'
import NotFoundError from '@/shared/errors/not-found.error.js'
import SshConnectionError from '@/shared/errors/ssh-connection.error.js'
import ValidationError from '@/shared/errors/validation.error.js'
import { canLogin, hasSudo, isSystemAccount, SYSTEM_USERNAME_PATTERN } from './system-user.rules.js'

// --> Printed before each part of the output, to split the output of the single command
const MARKER = '@@SERVER-PANEL:'

// --> One script for everything, so one channel is used. LC_ALL=C: same English output on every server
// the user name is read from the input (stdin). Without root rights the parts that need them stay empty
// the private keys of the user (~/.ssh/id_*) and /etc/shadow are never read
const SCRIPT = /* SHELL */ `
  export LC_ALL=C
  IFS= read -r u

  ${DETECT_SUDO}

  line=$(getent passwd "$u" 2>/dev/null || grep "^$u:" /etc/passwd)
  home=$(printf "%s" "$line" | cut -d: -f6)

  echo "${MARKER}passwd"; printf "%s\\n" "$line"
  echo "${MARKER}gids"; id -G "$u" 2>/dev/null
  echo "${MARKER}groups"; id -Gn "$u" 2>/dev/null
  echo "${MARKER}me"; id -un
  echo "${MARKER}clock"; date "+%z %Y"
  echo "${MARKER}home"; [ -n "$home" ] && [ -d "$home" ] && echo yes
  echo "${MARKER}who"; who 2>/dev/null
  echo "${MARKER}processes"; ps -u "$u" -o pid= 2>/dev/null | wc -l; ps -u "$u" -o pid= >/dev/null 2>&1 && echo ok
  echo "${MARKER}lastlog"; lastlog -u "$u" 2>/dev/null
  echo "${MARKER}sudo"; [ "$has_sudo" = 1 ] && echo yes
  echo "${MARKER}password"; $S passwd -S "$u" 2>/dev/null </dev/null
  echo "${MARKER}aging"; $S chage -l "$u" 2>/dev/null </dev/null
  echo "${MARKER}keys"
  for file in "$home/.ssh/authorized_keys" "$home/.ssh/authorized_keys2"; do
    $S cat "$file" 2>/dev/null </dev/null
    echo
  done
  echo "${MARKER}end"
`

const KEY_LINE_PATTERN =
  /^(?:(.+?)\s+)?(ssh-ed25519|ssh-rsa|ssh-dss|ecdsa-sha2-nistp(?:256|384|521)|sk-[a-z0-9-]+@openssh\.com)\s+([A-Za-z0-9+/]+={0,2})(?:\s+(.*))?$/

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

interface GetSystemUserRequest {
  // --> EnsurePermissionHook already checked it belongs to the organization and the member can access it
  serverId: string
  username: string
  // --> Sudo password of the account on the server, only for an account whose sudo asks for one. Never saved
  sudoPassword?: string | undefined
}

interface SshKey {
  type: string
  // --> "SHA256:..." like `ssh-keygen -lf`
  fingerprint: string
  comment: string
  // --> Restrictions written before the key, like from="203.0.113.0/24"
  options: string | null
  publicKey: string
}

interface GetSystemUserResponse {
  username: string
  uid: number
  gid: number
  description: string
  home: string
  shell: string
  primaryGroup: string
  groups: { name: string; gid: number }[]
  isSystemAccount: boolean
  canLogin: boolean
  hasSudo: boolean
  homeExists: boolean
  // --> null when the server does not record it, or the user never logged in
  lastLogin: { at: string; from: string | null } | null
  activeSessions: { terminal: string; from: string | null; since: string }[]
  // --> null when the server cannot count them
  processCount: number | null
  // --> null when the service account has no root rights and the user is not the service account itself
  privileged: {
    passwordStatus: 'set' | 'locked' | 'none' | null
    passwordChangedAt: string | null
    passwordExpiresAt: string | null
    accountExpiresAt: string | null
    sshKeys: SshKey[]
  } | null
}

// --> Everything the app can read about one Linux user, with one command
export default class GetSystemUserUseCase {
  constructor(
    private readonly getServerConnection: GetServerConnectionUseCase = new GetServerConnectionUseCase(),
    private readonly commandRunner: SshCommandRunner = sshCommandRunner,
  ) {}

  public async execute({ serverId, username, sudoPassword }: GetSystemUserRequest): Promise<GetSystemUserResponse> {
    // --> the user name reaches a script on the server: checked here too, whatever the caller already did
    if (!SYSTEM_USERNAME_PATTERN.test(username)) {
      throw new ValidationError('Not a valid Linux user name')
    }

    // --> get the connection of the server and run the script, the user name goes to its input
    const connection = await this.getServerConnection.execute({ serverId })
    const { stdout } = await this.commandRunner.runScript(connection, {
      script: SCRIPT,
      stdin: `${username}\n`,
      sudoPassword,
    })

    // --> split the output into its parts: name -> lines
    const parts = new Map<string, string[]>()

    for (const part of stdout.split(MARKER).slice(1)) {
      const [name = '', ...lines] = part.split('\n').map((line) => line.trimEnd())

      parts.set(
        name.trim(),
        lines.filter((line) => line.trim() !== ''),
      )
    }

    if (!parts.has('end')) {
      throw new SshConnectionError('SSH_COMMAND_FAILED', 'The server did not return the details of the user')
    }

    // --> parse the user, a line is "name:password:uid:gid:description:home:shell"
    const fields = (parts.get('passwd')?.[0] ?? '').split(':')
    const [name, , rawUid, rawGid, gecos = '', home = '', shell = ''] = fields

    // --> check if the user exists on the server
    if (fields.length !== 7 || name !== username || !/^\d+$/.test(rawUid ?? '') || !/^\d+$/.test(rawGid ?? '')) {
      throw new NotFoundError('System user not found')
    }

    const uid = Number(rawUid)
    const gid = Number(rawGid)

    // --> pair group ids with their names, both commands print them in the same order
    const gids = (parts.get('gids')?.[0] ?? '').split(/\s+/).filter(Boolean)
    const groupNames = (parts.get('groups')?.[0] ?? '').split(/\s+/).filter(Boolean)

    const groups = gids.map((value, index) => ({
      name: groupNames[index] ?? value,
      gid: Number(value),
    }))

    const names = groups.map((group) => group.name)
    const primaryGroup = groups.find((group) => group.gid === gid)?.name ?? String(gid)

    // --> the time zone and the year of the server, "who" prints local times without them
    const [rawTimezone = '', rawYear = ''] = (parts.get('clock')?.[0] ?? '').split(' ')
    const timezone = /^[+-]\d{4}$/.test(rawTimezone) ? rawTimezone : '+0000'
    const serverYear = /^\d{4}$/.test(rawYear) ? Number(rawYear) : new Date().getUTCFullYear()

    // --> open sessions of this user, a line is "name terminal Oct  9 09:10 (from)",
    // or "name terminal 2026-10-09 09:10 (from)" on servers with another locale
    const activeSessions: GetSystemUserResponse['activeSessions'] = []

    for (const line of parts.get('who') ?? []) {
      const match =
        /^(\S+)\s+(\S+)\s+(?:(\d{4})-(\d{2})-(\d{2})|(\w{3})\s+(\d{1,2})) (\d{2}:\d{2})(?:\s+\((.*)\))?/.exec(line)

      if (!match || match[1] !== username) {
        continue
      }

      const [, , terminal, isoYear, isoMonth, isoDay, monthName, monthDay, time, from] = match
      const month = isoMonth ?? String(MONTHS.indexOf(monthName as string) + 1).padStart(2, '0')
      const day = (isoDay ?? monthDay ?? '').padStart(2, '0')

      // --> the short form has no year: it is this year, or last year when that would be in the future
      let since = new Date(`${isoYear ?? serverYear}-${month}-${day}T${time}:00${timezone}`)

      if (!isoYear && since.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
        since = new Date(`${serverYear - 1}-${month}-${day}T${time}:00${timezone}`)
      }

      // --> skip a line with a date that cannot be read
      if (Number.isNaN(since.getTime())) {
        continue
      }

      activeSessions.push({
        terminal: terminal as string,
        from: from || null,
        since: since.toISOString(),
      })
    }

    // --> last login, the line ends with a date like "Thu Oct  8 14:22:10 +0000 2026"
    let lastLogin: GetSystemUserResponse['lastLogin'] = null

    const lastlogLine = (parts.get('lastlog') ?? []).find((line) => line.startsWith(`${username} `))
    const lastlogMatch =
      /^\S+\s+(?:(\S+)\s+)?(?:(\S+)\s+)?\w{3} (\w{3})\s+(\d{1,2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{4}) (\d{4})$/.exec(
        lastlogLine ?? '',
      )

    if (lastlogMatch) {
      const [, first, second, month, day, time, offset, year] = lastlogMatch
      const monthNumber = MONTHS.indexOf(month as string) + 1

      lastLogin = {
        at: new Date(
          `${year}-${String(monthNumber).padStart(2, '0')}-${String(day).padStart(2, '0')}T${time}${offset}`,
        ).toISOString(),
        // --> with two columns before the date the second one is the address, a local login has the terminal only
        from: second ?? (first?.includes('.') || first?.includes(':') ? first : null) ?? null,
      }
    }

    // --> number of processes, the second line is printed only when ps accepted the options
    const [processLine, processOk] = parts.get('processes') ?? []
    const processCount = processOk === 'ok' && /^\d+$/.test(processLine?.trim() ?? '') ? Number(processLine) : null

    // --> privileged part: needs sudo, except the keys of the service account itself
    const canSudo = parts.get('sudo')?.[0] === 'yes'
    const isOwnAccount = parts.get('me')?.[0] === username

    let privileged: GetSystemUserResponse['privileged'] = null

    if (canSudo || isOwnAccount) {
      // --> password status, a line is "name P 2026-09-01 0 99999 7 -1" (P set, L locked, NP none)
      const statusCode = (parts.get('password')?.[0] ?? '').split(/\s+/)[1]

      const passwordStatus =
        statusCode === 'P' || statusCode === 'PS'
          ? 'set'
          : statusCode === 'L' || statusCode === 'LK'
            ? 'locked'
            : statusCode === 'NP'
              ? 'none'
              : null

      // --> password and account dates, a line is "Password expires : Sep 01, 2026" (or "never")
      const aging = new Map<string, string | null>()

      for (const line of parts.get('aging') ?? []) {
        const [label = '', value = ''] = line.split(':').map((text) => text.trim())
        const match = /^(\w{3}) (\d{1,2}), (\d{4})$/.exec(value)
        const monthNumber = match ? MONTHS.indexOf(match[1] as string) + 1 : 0

        aging.set(
          label,
          /^\d{4}-\d{2}-\d{2}$/.test(value)
            ? value
            : match && monthNumber > 0
              ? `${match[3]}-${String(monthNumber).padStart(2, '0')}-${String(match[2]).padStart(2, '0')}`
              : null,
        )
      }

      // --> public keys allowed to log in as this user, a line is "[options] type key [comment]"
      const sshKeys: SshKey[] = []

      for (const line of parts.get('keys') ?? []) {
        const match = KEY_LINE_PATTERN.exec(line.trim())

        // --> skip comments and broken lines
        if (!match || line.trim().startsWith('#')) {
          continue
        }

        const [, options, type, key, comment = ''] = match as unknown as [
          string,
          string | undefined,
          string,
          string,
          string?,
        ]

        sshKeys.push({
          type,
          fingerprint: `SHA256:${createHash('sha256').update(Buffer.from(key, 'base64')).digest('base64').replace(/=+$/, '')}`,
          comment: comment.trim(),
          options: options ?? null,
          publicKey: `${type} ${key}${comment.trim() ? ` ${comment.trim()}` : ''}`,
        })
      }

      privileged = {
        passwordStatus,
        passwordChangedAt: aging.get('Last password change') ?? null,
        passwordExpiresAt: aging.get('Password expires') ?? null,
        accountExpiresAt: aging.get('Account expires') ?? null,
        sshKeys,
      }
    }

    return {
      username,
      uid,
      gid,
      // --> the field can hold "Full Name,Room,Phone", only the name is kept
      description: gecos.split(',')[0] ?? '',
      home,
      shell,
      primaryGroup,
      groups,
      isSystemAccount: isSystemAccount(uid),
      canLogin: canLogin(shell),
      hasSudo: hasSudo(uid, names),
      homeExists: parts.get('home')?.[0] === 'yes',
      lastLogin,
      activeSessions,
      processCount,
      privileged,
    }
  }
}
