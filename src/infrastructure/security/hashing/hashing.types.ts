// --> Implemented by every hashing service, code that needs hashing depends on this interface only
// a new algorithm is a new class implementing it, existing code stays untouched
export interface Hasher {
  hash(value: string): Promise<string>
  compare(value: string, hash: string): Promise<boolean>
}
