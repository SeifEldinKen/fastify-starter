export const SERVICE_SUFFIX = '.service'

// --> Name of a systemd service without ".service": it never starts with "-", so it cannot be read as an option
// "@" is for services started from a template (worker@1), "\" is how systemd writes special characters (\x2d)
export const SERVICE_NAME_PATTERN = /^[a-zA-Z0-9_][a-zA-Z0-9:_.@\\-]{0,200}$/

export const SERVICE_STATUSES = ['running', 'exited', 'starting', 'stopping', 'failed', 'stopped'] as const

export type ServiceStatus = (typeof SERVICE_STATUSES)[number]

export const SERVICE_STARTUPS = ['enabled', 'disabled', 'static', 'masked', 'other'] as const

export type ServiceStartup = (typeof SERVICE_STARTUPS)[number]

// --> Turns the two states of systemd into the one status the client shows
export const toServiceStatus = (active: string, sub: string): ServiceStatus => {
  switch (active) {
    case 'failed':
      return 'failed'
    case 'activating':
      // --> "auto-restart" is a service that crashed and waits for systemd to start it again
      return sub === 'auto-restart' ? 'failed' : 'starting'
    case 'deactivating':
      return 'stopping'
    case 'inactive':
      return 'stopped'
    default:
      // --> "active" and "reloading": "exited" is a service that did its job and ended well, like a one time setup
      return sub === 'exited' ? 'exited' : 'running'
  }
}

// --> How the service starts at boot, from the state of its file
export const toServiceStartup = (state: string): ServiceStartup => {
  if (state.startsWith('enabled')) {
    return 'enabled'
  }

  if (state.startsWith('masked')) {
    return 'masked'
  }

  if (state === 'disabled' || state === 'static') {
    return state
  }

  // --> indirect, generated, linked, transient ...
  return 'other'
}
