import BaseError from './base.error.js'

// --> 403: the user is known, but not allowed to do this
export default class ForbiddenError extends BaseError {
  public readonly statusCode = 403

  constructor(
    public readonly code: 'PERMISSION_DENIED' | 'MEMBERSHIP_SUSPENDED' = 'PERMISSION_DENIED',
    message = 'You do not have permission to perform this action',
  ) {
    super(message)
  }
}
