import { REQUIRE_SUDO } from './sudo.script.js'

// --> Printed by the script as its last line: "OK", or "ERROR:<reason>"
export const SCRIPT_RESULT_MARKER = '@@SERVER-PANEL:'

const MARKER = SCRIPT_RESULT_MARKER

// --> The whole script is fixed text: every value is read from the input (stdin), line by line,
// so nothing typed by a user is ever part of a command. It needs root rights
// when a step fails after the user was created, the user is deleted again: no half created user is left behind
const SCRIPT = /* SHELL */ `
  set -u
  IFS= read -r username
  IFS= read -r description
  IFS= read -r shell
  IFS= read -r create_home
  IFS= read -r groups
  IFS= read -r want_sudo
  IFS= read -r must_change
  IFS= read -r password

  fail() { echo "${MARKER}ERROR:$1"; exit 1; }
  has_group() { getent group "$1" >/dev/null 2>&1 || grep -q "^$1:" /etc/group; }

  ${REQUIRE_SUDO}

  if getent passwd "$username" >/dev/null 2>&1 || grep -q "^$username:" /etc/passwd; then fail USER_EXISTS; fi
  if has_group "$username"; then fail GROUP_EXISTS; fi

  [ -x "$shell" ] || fail INVALID_SHELL
  if ! grep -qxF "$shell" /etc/shells 2>/dev/null; then
    case "$shell" in */nologin|*/false) ;; *) fail INVALID_SHELL ;; esac
  fi

  admin=""
  if [ "$want_sudo" = 1 ]; then
    for g in sudo wheel; do if has_group "$g"; then admin="$g"; break; fi; done
    [ -n "$admin" ] || fail NO_SUDO_GROUP
  fi

  all_groups=$(echo "$groups,$admin" | tr "," " ")
  for g in $all_groups; do has_group "$g" || fail "GROUP_NOT_FOUND:$g"; done

  if command -v useradd >/dev/null 2>&1; then
    if [ "$create_home" = 1 ]; then home_option=-m; else home_option=-M; fi
    $S useradd "$home_option" -s "$shell" -c "$description" "$username" </dev/null >/dev/null || fail CREATE_FAILED
  else
    if [ "$create_home" = 1 ]; then
      $S adduser -D -s "$shell" -g "$description" "$username" </dev/null >/dev/null || fail CREATE_FAILED
    else
      $S adduser -D -H -s "$shell" -g "$description" "$username" </dev/null >/dev/null || fail CREATE_FAILED
    fi
  fi

  rollback() {
    $S userdel -r "$username" >/dev/null 2>&1 || $S deluser --remove-home "$username" >/dev/null 2>&1
    fail "$1"
  }

  for g in $all_groups; do
    if command -v usermod >/dev/null 2>&1; then
      $S usermod -aG "$g" "$username" </dev/null >/dev/null || rollback GROUP_ADD_FAILED
    else
      $S addgroup "$username" "$g" </dev/null >/dev/null || rollback GROUP_ADD_FAILED
    fi
  done

  if [ -n "$password" ]; then
    printf "%s:%s\\n" "$username" "$password" | $S chpasswd || rollback PASSWORD_REJECTED
    if [ "$must_change" = 1 ]; then
      $S chage -d 0 "$username" </dev/null 2>/dev/null || $S passwd -e "$username" </dev/null >/dev/null 2>&1 || rollback MUST_CHANGE_UNSUPPORTED
    fi
  elif ! command -v useradd >/dev/null 2>&1; then
    printf "%s:*\\n" "$username" | $S chpasswd -e 2>/dev/null
  fi

  keys=$(cat)
  if [ -n "$keys" ]; then
    home=$(getent passwd "$username" 2>/dev/null | cut -d: -f6)
    [ -n "$home" ] || home=$(grep "^$username:" /etc/passwd | cut -d: -f6)
    $S mkdir -p "$home/.ssh" \\
      && printf "%s\\n" "$keys" | $S tee "$home/.ssh/authorized_keys" >/dev/null \\
      && $S chmod 700 "$home/.ssh" \\
      && $S chmod 600 "$home/.ssh/authorized_keys" \\
      && $S chown -R "$username:$(id -g "$username")" "$home/.ssh" \\
      || rollback KEYS_FAILED
  fi

  echo "${MARKER}OK"
`

export interface CreateSystemUserScriptInput {
  username: string
  description: string
  shell: string
  createHome: boolean
  groups: string[]
  sudo: boolean
  mustChangePassword: boolean
  // --> Empty for a user without password
  password: string
  // --> Public keys, one "type key comment" each
  sshKeys: string[]
}

export interface SshScript {
  // --> Shell script as plain text, fixed and safe to log. Run it with sshCommandRunner.runScript
  script: string
  // --> The values of the request, never log it: the password is one of its lines
  stdin: string
}

// --> The script that creates a Linux user, with its input: run them with sshCommandRunner.runScript(connection, { script, stdin })
// every value must be validated by the caller first, one value per line: none of them can contain a line break
export const createSystemUserScript = (input: CreateSystemUserScriptInput): SshScript => {
  return {
    script: SCRIPT,
    stdin: [
      input.username,
      input.description,
      input.shell,
      input.createHome ? '1' : '0',
      input.groups.join(','),
      input.sudo ? '1' : '0',
      input.mustChangePassword ? '1' : '0',
      input.password,
      ...input.sshKeys,
      '',
    ].join('\n'),
  }
}
