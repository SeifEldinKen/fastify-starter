import type { Client, SFTPWrapper } from 'ssh2'

// --> What is needed to open one SSH connection: a private key, or a password
export interface OpenConnectionRequest {
  host: string
  port: number
  username: string
  // --> Decrypted private key, as text
  privateKey?: string | undefined
  // --> Only to add a key of the panel to a new server (see ssh-key.installer.ts): never saved, never logged
  password?: string | undefined
  // --> Saved on the first connection, when given the connection is refused if the server shows another key
  hostFingerprint?: string | undefined
}

// --> What the manager needs on top of that, to keep the connection. A kept connection always uses a key
export interface ConnectRequest extends Omit<OpenConnectionRequest, 'privateKey' | 'password'> {
  serverId: string
  organizationId: string
  privateKey: string
}

export interface SshConnection {
  // --> For commands (exec)
  client: Client
  // --> One SFTP channel shared by every file operation on this server
  sftp: SFTPWrapper
  // --> "SHA256:..." like `ssh-keygen -lf`, the caller saves it after the first connection
  hostFingerprint: string
}
