import BaseError from './base.error.js'

// --> Same error for an unknown email and a wrong password, so nobody learns which emails are registered
export default class InvalidCredentialsError extends BaseError {
  public readonly statusCode = 401
  public readonly code = 'INVALID_CREDENTIALS'

  constructor(message = 'Invalid email or password') {
    super(message)
  }
}
