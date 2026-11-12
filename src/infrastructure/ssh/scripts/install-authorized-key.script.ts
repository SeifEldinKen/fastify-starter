// --> Printed by the script as its last line: "OK", or "ERROR:<reason>"
export const INSTALL_KEY_RESULT_MARKER = '@@SERVER-PANEL:'

const MARKER = INSTALL_KEY_RESULT_MARKER

// --> Fixed text, the public key is read from the input (stdin). It needs no sudo: it only touches the home of the account
// like ssh-copy-id: the folder and the file are only readable by the account, a key already there is not added twice
const SCRIPT = /* SHELL */ `
  set -u
  IFS= read -r key

  fail() { echo "${MARKER}ERROR:$1"; exit 1; }

  [ -n "\${HOME:-}" ] && [ -d "$HOME" ] || fail NO_HOME

  umask 077
  dir="$HOME/.ssh"
  file="$dir/authorized_keys"

  mkdir -p "$dir" || fail NOT_WRITABLE
  chmod 700 "$dir" || fail NOT_WRITABLE
  [ -f "$file" ] || : > "$file" || fail NOT_WRITABLE
  chmod 600 "$file" || fail NOT_WRITABLE

  if ! grep -qxF "$key" "$file"; then
    # --> a last line without its line break would be glued to the new key
    if [ -s "$file" ] && [ -n "$(tail -c 1 "$file")" ]; then echo >> "$file" || fail NOT_WRITABLE; fi
    printf "%s\\n" "$key" >> "$file" || fail NOT_WRITABLE
  fi

  # --> SELinux (RHEL, AlmaLinux, Fedora): sshd reads the file only with the right label
  if command -v restorecon >/dev/null 2>&1; then restorecon -R "$dir" >/dev/null 2>&1 || true; fi

  echo "${MARKER}OK"
`

// --> The script that adds a public key to the account: run it with sshCommandRunner.runScript(connection, { script, stdin })
export const installAuthorizedKeyScript = (publicKey: string): { script: string; stdin: string } => {
  return {
    script: SCRIPT,
    stdin: `${publicKey}\n`,
  }
}
