import BaseError from './base.error.js'

type FileErrorCode =
  // --> The Linux account used to connect has no right on this path: this is the server refusing, not the panel
  | 'FILE_PERMISSION_DENIED'
  // --> The panel never reads or changes this path, whatever the account can do
  | 'FILE_PATH_PROTECTED'
  | 'FILE_NOT_A_DIRECTORY'
  | 'FILE_NOT_A_FILE'
  | 'FILE_TOO_LARGE'
  | 'FILE_NOT_TEXT'
  | 'FILE_OPERATION_FAILED'

// --> 422: the request is valid, but the server or the panel refuses it for this path
export default class FileError extends BaseError {
  public readonly statusCode = 422

  constructor(
    public readonly code: FileErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}
