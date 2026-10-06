import BaseError from './base.error.js'

export default class UnauthorizedError extends BaseError {
  public readonly statusCode = 401
  public readonly code = 'UNAUTHORIZED'

  constructor(message = 'Unauthorized') {
    super(message)
  }
}
