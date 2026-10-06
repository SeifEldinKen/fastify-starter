import BaseError from './base.error.js'

type SshConnectionErrorCode = 'SSH_UNREACHABLE' | 'SSH_AUTH_FAILED' | 'SSH_HOST_KEY_MISMATCH' | 'SSH_COMMAND_TIMEOUT'

// --> 422, not 5xx: the client must see the code and message to fix the server settings
export default class SshConnectionError extends BaseError {
  public readonly statusCode = 422

  constructor(
    public readonly code: SshConnectionErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}
