import BaseError from './base.error.js'

export default class TooManyRequestsError extends BaseError {
  public readonly statusCode = 429
  public readonly code = 'TOO_MANY_REQUESTS'

  constructor(retryAfterSeconds: number) {
    super(`Too many requests, please try again in ${retryAfterSeconds} seconds`)
  }
}
