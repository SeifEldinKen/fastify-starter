import BaseError from './base.error.js'

// --> 500: the global error handler logs it and hides the message from the client
export default class DecryptionError extends BaseError {
  public readonly statusCode = 500
  public readonly code = 'DECRYPTION_FAILED'

  constructor(options?: ErrorOptions) {
    super('Stored value could not be decrypted', options)
  }
}
