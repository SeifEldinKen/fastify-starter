import GetServerConnectionUseCase from '@/domain/use-cases/ssh/get-server-connection.usecase.js'
import type SshCommandRunner from '@/infrastructure/ssh/ssh-command.runner.js'
import { sshCommandRunner } from '@/infrastructure/ssh/ssh-command.runner.js'
import SshConnectionError from '@/shared/errors/ssh-connection.error.js'
import Logger from '@/shared/logger.js'
import { canLogin, hasSudo, isSystemAccount } from './system-user.rules.js'

// --> Printed between the two lists, to split the output of the single command
const SEPARATOR = '---SERVER-PANEL-GROUPS---'

// --> Fixed command, nothing typed by a user ever goes into it
// getent also returns users from LDAP and similar sources, the files are the fallback where it is missing
const COMMAND = /* SHELL */ `(getent passwd || cat /etc/passwd); echo '${SEPARATOR}'; (getent group || cat /etc/group)`

interface ListSystemUsersRequest {
  // --> EnsurePermissionHook already checked it belongs to the organization and the member can access it
  serverId: string
  // --> Also return the accounts of the system and its services (www-data, sshd ...)
  includeSystem: boolean
}

interface SystemUser {
  username: string
  uid: number
  gid: number
  description: string
  home: string
  shell: string
  primaryGroup: string
  // --> The primary group first, then the other groups sorted by name
  groups: string[]
  isSystemAccount: boolean
  canLogin: boolean
  // --> From group membership only: a rule written for one user in /etc/sudoers.d is not seen
  hasSudo: boolean
}

interface ListSystemUsersResponse {
  total: number
  users: SystemUser[]
}

// --> Linux users of a server with their groups, read with one command that needs no sudo
export default class ListSystemUsersUseCase {
  constructor(
    private readonly logger: Logger = new Logger('SystemUsers'),
    private readonly getServerConnection: GetServerConnectionUseCase = new GetServerConnectionUseCase(),
    private readonly commandRunner: SshCommandRunner = sshCommandRunner,
  ) {}

  public async execute({ serverId, includeSystem }: ListSystemUsersRequest): Promise<ListSystemUsersResponse> {
    // --> get the connection of the server and run the command
    const connection = await this.getServerConnection.execute({ serverId })

    // --> run the command
    const { stdout } = await this.commandRunner.run(connection, {
      command: /* SHELL */ `
        (getent passwd || cat /etc/passwd); echo '${SEPARATOR}'; (getent group || cat /etc/group)
      `,
    })

    // --> split the two lists
    const [passwdOutput, groupOutput] = stdout.split(SEPARATOR)

    if (passwdOutput === undefined || groupOutput === undefined) {
      throw new SshConnectionError('SSH_COMMAND_FAILED', 'The server did not return its users')
    }

    // --> parse groups, a line is "name:password:gid:member1,member2"
    const groupNames = new Map<number, string>()
    const groupsOfUser = new Map<string, string[]>()

    for (const line of groupOutput.split('\n')) {
      const [name, , gid, members = ''] = line.trim().split(':')

      // --> skip empty and broken lines
      if (!name || !gid || !/^\d+$/.test(gid)) {
        continue
      }

      groupNames.set(Number(gid), name)

      for (const member of members.split(',')) {
        if (member) {
          groupsOfUser.set(member, [...(groupsOfUser.get(member) ?? []), name])
        }
      }
    }

    // --> parse users, a line is "name:password:uid:gid:description:home:shell"
    const users: SystemUser[] = []

    for (const line of passwdOutput.split('\n')) {
      const fields = line.trim().split(':')
      const [username, , rawUid, rawGid, gecos = '', home = '', shell = ''] = fields

      // --> skip empty and broken lines
      if (fields.length !== 7 || !username || !rawUid || !rawGid || !/^\d+$/.test(rawUid) || !/^\d+$/.test(rawGid)) {
        continue
      }

      const uid = Number(rawUid)
      const gid = Number(rawGid)
      if (isSystemAccount(uid) && !includeSystem) {
        continue
      }

      // --> a group can exist only as the primary group of a user, then its name is unknown
      const primaryGroup = groupNames.get(gid) ?? String(gid)

      const otherGroups = (groupsOfUser.get(username) ?? []).filter((group) => group !== primaryGroup).sort()
      const groups = [primaryGroup, ...new Set(otherGroups)]

      users.push({
        username,
        uid,
        gid,
        description: gecos.split(',')[0] ?? '',
        home,
        shell,
        primaryGroup,
        groups,
        isSystemAccount: isSystemAccount(uid),
        canLogin: canLogin(shell),
        hasSudo: hasSudo(uid, groups),
      })
    }

    // --> root first, then by user id
    users.sort((first, second) => first.uid - second.uid)

    return {
      total: users.length,
      users,
    }
  }
}
