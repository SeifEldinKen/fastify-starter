// --> Printed by the script before each part of its output
export const SERVICES_MARKER = '@@SERVER-PANEL:'

const MARKER = SERVICES_MARKER

// --> Fixed text, it reads nothing from a request and needs no sudo
// list-units gives the state right now, list-unit-files gives every installed service and how it starts at boot
const SCRIPT = /* SHELL */ `
  if [ ! -d /run/systemd/system ] || ! command -v systemctl >/dev/null 2>&1; then
    echo "${MARKER}NO_SYSTEMD"
    exit 0
  fi

  echo "${MARKER}UNITS"
  LC_ALL=C systemctl list-units --type=service --all --plain --no-legend --no-pager </dev/null

  echo "${MARKER}UNIT_FILES"
  LC_ALL=C systemctl list-unit-files --type=service --no-legend --no-pager </dev/null

  echo "${MARKER}END"
`

// --> The script that lists the systemd services of a server: run it with sshCommandRunner.runScript(connection, { script })
export const listServicesScript = (): { script: string } => {
  return {
    script: SCRIPT,
  }
}
