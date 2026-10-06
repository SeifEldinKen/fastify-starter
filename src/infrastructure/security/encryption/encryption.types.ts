// --> Two-way, unlike Hasher: the original value is needed again (e.g. an SSH private key to open a connection)
export interface Encryptor {
  encrypt(plain: string): string
  decrypt(encrypted: string): string
}
