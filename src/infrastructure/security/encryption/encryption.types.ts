// --> Two-way, unlike Hasher: the original value is needed again (e.g. an SSH private key to open a connection)
export interface Encryptor {
  encrypt(request: EncryptRequest): string
  decrypt(request: DecryptRequest): string
}

export interface EncryptRequest {
  // --> Plain value to encrypt
  value: string
}

export interface DecryptRequest {
  // --> Encrypted value, as returned by encrypt
  value: string
}
