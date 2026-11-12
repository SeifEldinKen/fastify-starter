import BaseError from './base.error.js'

type FirewallErrorCode =
  | 'FIREWALL_NOT_MANAGEABLE'
  | 'FIREWALL_WOULD_LOCK_OUT'
  | 'FIREWALL_RULE_NOT_CHANGEABLE'
  | 'FIREWALL_CHANGE_ROLLED_BACK'

// --> 422: the request is valid, but the firewall of this server cannot take the change
export default class FirewallError extends BaseError {
  public readonly statusCode = 422

  constructor(
    public readonly code: FirewallErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}
