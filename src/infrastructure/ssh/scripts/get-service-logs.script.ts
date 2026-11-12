import { SERVICES_MARKER } from './list-services.script.js'
import { DETECT_SUDO } from './sudo.script.js'

const MARKER = SERVICES_MARKER

// --> Fixed text, the name of the service and the number of lines are read from the input (stdin)
// the journal is only open to root and to the members of a few groups, sudo is used when the account has it
// each line of the journal is printed as one JSON object, so nothing written by a service can look like a marker
const SCRIPT = /* SHELL */ `
  IFS= read -r name
  IFS= read -r lines

  ${DETECT_SUDO}

  # --> without root rights, the members of a few groups can still read the journal
  if [ "$has_sudo" = 0 ] && ! id -Gn | tr " " "\\n" | grep -qxE "adm|systemd-journal|wheel"; then
    stop_without_sudo
  fi

  if [ ! -d /run/systemd/system ] || ! command -v systemctl >/dev/null 2>&1; then
    echo "${MARKER}NO_SYSTEMD"
    exit 0
  fi

  echo "${MARKER}LOAD"
  LC_ALL=C systemctl show --no-pager --property=LoadState -- "$name.service" </dev/null

  echo "${MARKER}LOGS"
  $S journalctl --no-pager --output=json --lines="$lines" --unit="$name.service" </dev/null 2>/dev/null

  echo
  echo "${MARKER}END"
`

export interface GetServiceLogsScriptInput {
  // --> Without ".service", already checked with SERVICE_NAME_PATTERN
  name: string
  // --> How many lines to read from the end of the journal
  lines: number
}

// --> The script that reads the last log lines of one systemd service, with its input: run them with sshCommandRunner.runScript
export const getServiceLogsScript = (input: GetServiceLogsScriptInput): { script: string; stdin: string } => {
  return {
    script: SCRIPT,
    stdin: `${input.name}\n${input.lines}\n`,
  }
}
