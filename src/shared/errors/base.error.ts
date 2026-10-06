// --> Parent of every error thrown by the app
export default abstract class BaseError extends Error {
  // --> HTTP status, read by the global error handler
  public abstract readonly statusCode: number
  // --> Stable identifier for the client, e.g. 'TOKEN_EXPIRED' (messages can change, codes cannot)
  public abstract readonly code: string

  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    // --> Name of the child class (e.g. InvalidTokenError), shown in logs and stack traces
    this.name = new.target.name
  }
}
