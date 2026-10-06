import BaseError from './base.error.js'

export default class NotFoundError extends BaseError {
  public readonly statusCode = 404
  public readonly code = 'NOT_FOUND'

  constructor(message = 'Not Found') {
    super(message)
  }
}
