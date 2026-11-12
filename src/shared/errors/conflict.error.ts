import BaseError from './base.error.js'

// --> 409: the request is valid, but it collides with something that already exists
export default class ConflictError extends BaseError {
  public readonly statusCode = 409

  constructor(
    public readonly code: 'EMAIL_ALREADY_EXISTS' | 'SERVER_ALREADY_EXISTS' | 'SYSTEM_USER_ALREADY_EXISTS',
    message: string,
  ) {
    super(message)
  }
}
