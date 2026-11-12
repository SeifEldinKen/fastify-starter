// --> What the app concludes about a Linux user from its raw fields, shared by the list and the details

// --> Regular accounts start at 1000 on Linux, below it they belong to the system and its services
const FIRST_REGULAR_UID = 1000
const NOBODY_UID = 65534

// --> A user with one of these as shell cannot open a session
const NO_LOGIN_SHELLS = ['nologin', 'false', 'sync', 'shutdown', 'halt']

// --> Members of these groups can run commands as root
const SUDO_GROUPS = ['sudo', 'wheel', 'admin']

// --> The only characters accepted in a user name that goes into a command
export const SYSTEM_USERNAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_.-]{0,31}$/

// --> Stricter for names the app creates: what useradd accepts by default on every distribution
export const NEW_SYSTEM_USERNAME_PATTERN = /^[a-z_][a-z0-9_-]{0,31}$/
export const NEW_SYSTEM_GROUP_PATTERN = /^[a-z_][a-z0-9_-]{0,31}$/

export const isSystemAccount = (uid: number): boolean => {
  return uid !== 0 && (uid < FIRST_REGULAR_UID || uid === NOBODY_UID)
}

// --> An empty shell means the default one
export const canLogin = (shell: string): boolean => {
  return !NO_LOGIN_SHELLS.includes(shell.split('/').pop() ?? '')
}

// --> From group membership only: a rule written for one user in /etc/sudoers.d is not seen
export const hasSudo = (uid: number, groups: string[]): boolean => {
  return uid === 0 || groups.some((group) => SUDO_GROUPS.includes(group))
}
