import { createHash } from 'node:crypto'
import { type AuthenticationType, type AuthHandlerMiddleware, Client } from 'ssh2'
import SshConnectionError from '../../shared/errors/ssh-connection.error.js'
import type { OpenConnectionRequest, SshConnection } from './ssh-connection.types.js'

const CONNECT_TIMEOUT_MS = 10_000
const KEEPALIVE_INTERVAL_MS = 30_000
const KEEPALIVE_MAX_MISSED = 3

// --> Opens one SSH connection with its SFTP channel, keeps nothing: the caller owns the connection and closes it
export default class SshConnectionOpener {
  public open({
    host,
    port,
    username,
    privateKey,
    password,
    hostFingerprint,
  }: OpenConnectionRequest): Promise<SshConnection> {
    return new Promise((resolve, reject) => {
      const client = new Client()
      let actualFingerprint = ''
      let isHostKeyMismatch = false
      let isPasswordAuthDisabled = false

      client.on('ready', () => {
        // --> open the shared SFTP channel
        client.sftp((error, sftp) => {
          if (error) {
            client.end()
            reject(new SshConnectionError('SSH_UNREACHABLE', 'Could not open the SFTP channel', { cause: error }))
            return
          }

          resolve({ client, sftp, hostFingerprint: actualFingerprint })
        })
      })

      // --> after the connection is ready these rejects do nothing, the promise is already resolved
      client.on('error', (error) => {
        if (isHostKeyMismatch) {
          reject(new SshConnectionError('SSH_HOST_KEY_MISMATCH', 'The server identity has changed', { cause: error }))
          return
        }

        if (isPasswordAuthDisabled) {
          reject(
            new SshConnectionError(
              'SSH_PASSWORD_AUTH_DISABLED',
              'The server does not allow signing in with a password, add it with a private key',
              { cause: error },
            ),
          )
          return
        }

        if (error.level === 'client-authentication') {
          reject(
            new SshConnectionError(
              'SSH_AUTH_FAILED',
              password !== undefined ? 'The server rejected the password' : 'The server rejected the key',
              { cause: error },
            ),
          )
          return
        }

        reject(new SshConnectionError('SSH_UNREACHABLE', 'Could not connect to the server', { cause: error }))
      })

      // --> closed before it was ready
      client.on('close', () => {
        reject(new SshConnectionError('SSH_UNREACHABLE', 'The connection was closed'))
      })

      // --> With a password: the server first says which ways of signing in it allows,
      // then "password" is tried, then "keyboard-interactive" (the same password, asked as a question)
      const tried = new Set<AuthenticationType>()

      const passwordAuthHandler = (secret: string) => (methodsLeft: AuthenticationType[] | null) => {
        // --> first call: "none" only asks the server for the list
        if (methodsLeft === null) {
          return { type: 'none', username }
        }

        if (!tried.has('password') && methodsLeft.includes('password')) {
          tried.add('password')
          return { type: 'password', username, password: secret }
        }

        if (!tried.has('keyboard-interactive') && methodsLeft.includes('keyboard-interactive')) {
          tried.add('keyboard-interactive')

          return {
            type: 'keyboard-interactive',
            username,
            // --> every question gets the password
            prompt: (
              _name: string,
              _instructions: string,
              _lang: string,
              prompts: unknown[],
              finish: (answers: string[]) => void,
            ) => {
              finish(prompts.map(() => secret))
            },
          }
        }

        // --> nothing was tried: the server does not take passwords at all
        isPasswordAuthDisabled = tried.size === 0

        return false
      }

      try {
        client.connect({
          host,
          port,
          username,
          ...(password !== undefined
            ? { authHandler: passwordAuthHandler(password) as unknown as AuthHandlerMiddleware }
            : // --> without a key either, connect() refuses the empty key
              { privateKey: privateKey ?? '' }),
          readyTimeout: CONNECT_TIMEOUT_MS,
          // --> detects a dead connection: 3 unanswered keepalives close it
          keepaliveInterval: KEEPALIVE_INTERVAL_MS,
          keepaliveCountMax: KEEPALIVE_MAX_MISSED,
          // --> check the identity of the server before sending anything
          hostVerifier: (key: Buffer) => {
            actualFingerprint = `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`
            isHostKeyMismatch = hostFingerprint !== undefined && hostFingerprint !== actualFingerprint

            return !isHostKeyMismatch
          },
        })
      } catch (error) {
        // --> connect() throws immediately when the private key cannot be parsed
        reject(new SshConnectionError('SSH_AUTH_FAILED', 'The private key is not valid', { cause: error }))
      }
    })
  }
}
