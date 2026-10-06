import BaseError from './base.error.js'

export default class ValidationError extends BaseError {
  public readonly statusCode = 400
  public readonly code = 'VALIDATION_ERROR'
}
