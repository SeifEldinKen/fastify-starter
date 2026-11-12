// --> Printed as the first line of its output by a script that cannot work without root rights
// the command runner turns them into the error the client sees, no use case has to look for them
// REQUIRED: the account has sudo, but it asks for a password. NOT_ALLOWED: the account has no sudo at all
export const SUDO_REQUIRED_MARKER = '@@SERVER-PANEL:SUDO_REQUIRED'
export const SUDO_NOT_ALLOWED_MARKER = '@@SERVER-PANEL:SUDO_NOT_ALLOWED'

// --> Defines stop_without_sudo: it tells which of the two cases the account is in, then ends the script
// "sudo -n -v" never asks for a password: it says at once when the account is not allowed to use sudo
const STOP_WITHOUT_SUDO = /* SHELL */ `
  stop_without_sudo() {
    if ! command -v sudo >/dev/null 2>&1; then
      echo "${SUDO_NOT_ALLOWED_MARKER}"
      exit 0
    fi

    case "$(LC_ALL=C sudo -n -v 2>&1 </dev/null)" in
      *"may not run sudo"* | *sudoers*) echo "${SUDO_NOT_ALLOWED_MARKER}" ;;
      *) echo "${SUDO_REQUIRED_MARKER}" ;;
    esac

    exit 0
  }
`

// --> Start of a script that needs root rights for everything it does
// it sets S: empty when the script already runs as root, "sudo -n" when the account has sudo without password.
// every command that needs root rights is written "$S command". "sudo -n" never asks for a password
export const REQUIRE_SUDO = /* SHELL */ `
  ${STOP_WITHOUT_SUDO}

  if [ "$(id -u)" = 0 ]; then
    S=""
  elif sudo -n true </dev/null 2>/dev/null; then
    S="sudo -n"
  else
    stop_without_sudo
  fi
`

// --> Start of a script that still gives a part of its answer without root rights
// it sets S like above, and has_sudo to 1 or 0: the script decides what to do without them,
// it can call stop_without_sudo when it cannot go on
export const DETECT_SUDO = /* SHELL */ `
  ${STOP_WITHOUT_SUDO}

  if [ "$(id -u)" = 0 ]; then
    S=""
    has_sudo=1
  elif sudo -n true </dev/null 2>/dev/null; then
    S="sudo -n"
    has_sudo=1
  else
    S=""
    has_sudo=0
  fi
`

export const SUDO_PASSWORD_MARKER = '@@SERVER-PANEL:SUDO_PASSWORD_'

// --> Checks the sudo password of the account, read from the input (stdin), before it is used to run a script
// sudo asks again after a wrong password and would read the next lines of the input: here the password is the only line,
// so one try is made and nothing else can be taken for a password
// it prints NOT_NEEDED (root, or sudo without password), OK, INCORRECT, or NOT_ALLOWED (the account has no sudo at all)
export const VERIFY_SUDO_PASSWORD_SCRIPT = /* SHELL */ `
  if [ "$(id -u)" = 0 ] || sudo -n true </dev/null 2>/dev/null; then
    echo "${SUDO_PASSWORD_MARKER}NOT_NEEDED"
    exit 0
  fi

  if ! command -v sudo >/dev/null 2>&1; then
    echo "${SUDO_PASSWORD_MARKER}NOT_ALLOWED"
    exit 0
  fi

  sudo -k

  if output=$(LC_ALL=C sudo -S -p "" -v 2>&1); then
    echo "${SUDO_PASSWORD_MARKER}OK"
    exit 0
  fi

  case "$output" in
    *"may not run sudo"* | *sudoers* | *"not allowed"*) echo "${SUDO_PASSWORD_MARKER}NOT_ALLOWED" ;;
    *) echo "${SUDO_PASSWORD_MARKER}INCORRECT" ;;
  esac
`
