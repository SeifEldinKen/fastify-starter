import BaseError from './base.error.js'

// --> One error for every failure (unknown email, wrong code, expired, too many attempts)
// so the response never reveals whether the email is registered
export default class InvalidVerificationCodeError extends BaseError {
  public readonly statusCode = 400
  public readonly code = 'INVALID_VERIFICATION_CODE'

  constructor(message = 'The code is invalid or has expired, please request a new one') {
    super(message)
  }
}
