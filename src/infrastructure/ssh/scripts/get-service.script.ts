import { SERVICES_MARKER } from './list-services.script.js'

const MARKER = SERVICES_MARKER

// --> Only these values are asked from systemd: "Environment" is left out on purpose, it often holds passwords
const PROPERTIES = [
  'Id',
  'Description',
  'LoadState',
  'ActiveState',
  'SubState',
  'UnitFileState',
  'MainPID',
  'ExecMainStartTimestamp',
  'ExecMainExitTimestamp',
  'ExecMainStatus',
  'Result',
  'NRestarts',
  'MemoryCurrent',
  'CPUUsageNSec',
  'TasksCurrent',
  'FragmentPath',
  'ExecStart',
  'User',
  'WorkingDirectory',
  'Restart',
].join(',')

// --> Fixed text, the name of the service is read from the input (stdin). It needs no sudo
// TZ=UTC makes systemctl print every date in UTC, whatever the time zone of the server is
const SCRIPT = /* SHELL */ `
  IFS= read -r name

  if [ ! -d /run/systemd/system ] || ! command -v systemctl >/dev/null 2>&1; then
    echo "${MARKER}NO_SYSTEMD"
    exit 0
  fi

  echo "${MARKER}SHOW"
  TZ=UTC LC_ALL=C systemctl show --no-pager --property=${PROPERTIES} -- "$name.service" </dev/null

  echo "${MARKER}END"
`

export interface GetServiceScriptInput {
  // --> Without ".service", already checked with SERVICE_NAME_PATTERN
  name: string
}

// --> The script that reads the details of one systemd service, with its input: run them with sshCommandRunner.runScript
export const getServiceScript = (input: GetServiceScriptInput): { script: string; stdin: string } => {
  return {
    script: SCRIPT,
    stdin: `${input.name}\n`,
  }
}
