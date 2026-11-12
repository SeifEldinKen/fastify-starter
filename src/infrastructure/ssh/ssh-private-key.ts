import ssh2 from 'ssh2'
import ValidationError from '@/shared/errors/validation.error.js'

// --> Checks a private key before it is used: wrong format, or protected by a passphrase
export const assertUsablePrivateKey = (privateKey: string): void => {
  const parsedKey = ssh2.utils.parseKey(privateKey)

  if (parsedKey instanceof Error) {
    throw new ValidationError(
      parsedKey.message.includes('passphrase')
        ? 'Private keys protected by a passphrase are not supported'
        : 'The private key is not valid',
    )
  }
}
