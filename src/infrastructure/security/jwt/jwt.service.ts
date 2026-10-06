import jwt from 'jsonwebtoken'
import InvalidTokenError from '../../../shared/errors/invalid-token.error.js'
import type { SignTokenRequest, TokenPayload, VerifiedToken, VerifyTokenRequest } from './jwt.types.js'

const ALGORITHM = 'HS256'

export default class JwtService {
  public sign({ payload, secret, expiresIn, jwtid }: SignTokenRequest): string {
    return jwt.sign(payload, secret, {
      algorithm: ALGORITHM,
      expiresIn,
      ...(jwtid && { jwtid }),
    })
  }

  // --> Checks signature, expiry and token type
  public verify<T extends TokenPayload['type']>({ token, secret, type }: VerifyTokenRequest<T>): VerifiedToken<T> {
    let claims: jwt.JwtPayload | string

    try {
      // --> Pinned algorithm: a token signed with any other algorithm is rejected
      claims = jwt.verify(token, secret, {
        algorithms: [ALGORITHM],
      })
    } catch (error) {
      throw new InvalidTokenError(error instanceof jwt.TokenExpiredError ? 'expired' : 'invalid')
    }

    // --> Second guard next to the separate secrets: a refresh token is never accepted as an access token
    if (typeof claims === 'string' || claims.type !== type) {
      throw new InvalidTokenError('invalid')
    }

    return claims as VerifiedToken<T>
  }
}
