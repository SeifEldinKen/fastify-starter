// --> Implemented by every hashing service, code that needs hashing depends on this interface only
// a new algorithm is a new class implementing it, existing code stays untouched
export interface Hasher {
  hash(request: HashRequest): Promise<string>
  compare(request: CompareRequest): Promise<boolean>
}

export interface HashRequest {
  // --> Plain value to hash
  value: string
}

export interface CompareRequest {
  // --> Plain value to check
  value: string
  // --> Stored hash it is checked against
  hash: string
}
