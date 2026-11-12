import BaseError from './base.error.js'

type SudoErrorCode =
  // --> The account has no sudo without password: the client sends the request again with the password
  | 'SUDO_PASSWORD_REQUIRED'
  | 'SUDO_PASSWORD_INCORRECT'
  // --> The password is right, but the account is not allowed to use sudo on the server
  | 'SUDO_NOT_ALLOWED'

// --> 422, not 5xx: the client must see the code to ask for the password, or to explain what the server lacks
export default class SudoError extends BaseError {
  public readonly statusCode = 422

  constructor(
    public readonly code: SudoErrorCode,
    message: string,
  ) {
    super(message)
  }
}
