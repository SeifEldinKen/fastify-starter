import BaseError from './base.error.js'

export default class InvalidTokenError extends BaseError {
  public readonly statusCode = 401
  public readonly code: 'TOKEN_EXPIRED' | 'TOKEN_INVALID'

  constructor(reason: 'expired' | 'invalid') {
    super(reason === 'expired' ? 'Token expired' : 'Invalid token')
    this.code = reason === 'expired' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID'
  }
}
