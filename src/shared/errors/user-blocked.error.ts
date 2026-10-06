import BaseError from './base.error.js'

// --> 403, not 401: the user is known but not allowed in
export default class UserBlockedError extends BaseError {
  public readonly statusCode = 403
  public readonly code = 'USER_BLOCKED'

  constructor(message = 'This account has been blocked, please contact support') {
    super(message)
  }
}
