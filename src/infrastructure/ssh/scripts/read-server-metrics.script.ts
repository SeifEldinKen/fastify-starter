// --> Printed before each part of the output
export const SERVER_METRICS_MARKER = '@@SERVER-PANEL:'

const MARKER = SERVER_METRICS_MARKER

// --> Fixed text, it reads nothing from a request and needs no sudo
// the files of /proc exist on every Linux system, whatever the distribution is
const SCRIPT = /* SHELL */ `
  echo "${MARKER}STAT"; head -n 1 /proc/stat
  echo "${MARKER}MEMORY"; grep -E "^(MemTotal|MemFree|MemAvailable|Buffers|Cached|SwapTotal|SwapFree):" /proc/meminfo
  echo "${MARKER}LOAD"; cat /proc/loadavg
  echo "${MARKER}UPTIME"; cat /proc/uptime
  echo "${MARKER}CORES"; nproc 2>/dev/null || grep -c "^processor" /proc/cpuinfo
  echo "${MARKER}END"
`

// --> The script that reads the load of a server: run it with sshCommandRunner.runScript(connection, { script })
export const readServerMetricsScript = (): { script: string } => {
  return {
    script: SCRIPT,
  }
}
