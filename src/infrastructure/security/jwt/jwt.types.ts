import type { SignOptions } from 'jsonwebtoken'

export interface AccessTokenPayload {
  type: 'access'
  sub: string
  sid: string
  email: string
  firstName: string
  lastName: string
}

export interface RefreshTokenPayload {
  type: 'refresh'
  sub: string
  sid: string
}

export type TokenPayload = AccessTokenPayload | RefreshTokenPayload

export type VerifiedToken<T extends TokenPayload['type']> = Extract<TokenPayload, { type: T }> & {
  iat: number
  exp: number
  jti?: string
}

export interface SignTokenRequest {
  payload: TokenPayload
  secret: string
  // --> Seconds as a number, or a duration like '15m', '30d'
  expiresIn: NonNullable<SignOptions['expiresIn']>
  jwtid?: string
}

export interface VerifyTokenRequest<T extends TokenPayload['type']> {
  token: string
  secret: string
  // --> Expected token type, a token of the other type is rejected
  type: T
}
