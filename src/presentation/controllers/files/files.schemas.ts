import type { FastifySchema } from 'fastify'
import { z } from 'zod'
import { FILE_MODE_PATTERN, MAX_PATH_LENGTH, MAX_TEXT_FILE_BYTES } from '@/domain/use-cases/files/file.rules.js'
import { bearerAuth, errorResponseSchema } from '../shared.schemas.js'

const TAGS = ['Files']

const serverParams = z.object({
  organizationId: z.uuid(),
  serverId: z.uuid(),
})

export type ServerParams = z.infer<typeof serverParams>

// --> Sent to the server as data over SFTP, never as part of a command
const pathSchema = z
  .string()
  .min(1)
  .max(MAX_PATH_LENGTH)
  .startsWith('/', 'The path must be absolute, it starts with "/"')
  .regex(/^\P{Cc}*$/u, 'Cannot contain line breaks or control characters')

const fileTypeSchema = z.enum(['file', 'directory', 'symlink', 'other'])

const fileEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  type: fileTypeSchema.describe('"other" is a device, a socket or a pipe'),
  size: z.number().int().describe('In bytes'),
  mode: z.string().describe('"644"'),
  permissions: z.string().describe('"rw-r--r--"'),
  ownerId: z.number().int(),
  groupId: z.number().int(),
  owner: z.string().nullable().describe('Only known when a folder is listed'),
  group: z.string().nullable().describe('Only known when a folder is listed'),
  modifiedAt: z.iso.datetime(),
  link: z
    .object({
      target: z.string(),
      type: z.enum([...fileTypeSchema.options, 'missing']).describe('What the link points to, "missing" for nothing'),
    })
    .nullable()
    .describe('Only for a link'),
})

// --> Same answers on every route of this module
const fileErrorResponses = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema.describe('The server, or the path on the server, does not exist'),
  422: errorResponseSchema.describe(
    'The server could not be reached, the account used to connect has no right on this path, or the panel protects it',
  ),
}

/* LIST */
const listDirectoryQuery = z.object({
  path: pathSchema.optional().describe('Leave out for the home folder of the account used to connect'),
})

export type ListDirectoryQuery = z.infer<typeof listDirectoryQuery>

export const listDirectorySchema: FastifySchema = {
  tags: TAGS,
  summary: 'List what a folder of a server holds',
  security: bearerAuth,
  params: serverParams,
  querystring: listDirectoryQuery,
  response: {
    200: z.object({
      path: z.string().describe('The real path of the folder, after links are followed'),
      parent: z.string().nullable().describe('null for "/"'),
      total: z.number().int(),
      isTruncated: z.boolean().describe('true when the folder holds more entries than the ones returned'),
      entries: z.array(fileEntrySchema).describe('Folders first, then by name'),
    }),
    ...fileErrorResponses,
  },
}

/* READ */
const filePathQuery = z.object({
  path: pathSchema,
})

export type FilePathQuery = z.infer<typeof filePathQuery>

export const readFileSchema: FastifySchema = {
  tags: TAGS,
  summary: 'Read the content of a text file, up to 1 MB',
  security: bearerAuth,
  params: serverParams,
  querystring: filePathQuery,
  response: {
    200: fileEntrySchema.extend({ content: z.string() }),
    ...fileErrorResponses,
  },
}

/* DOWNLOAD */
// --> No schema for 200: the answer is the file itself, sent as a stream
export const downloadFileSchema: FastifySchema = {
  tags: TAGS,
  summary: 'Download a file, of any size and any kind',
  description: 'Answers 200 with the bytes of the file, as "application/octet-stream".',
  security: bearerAuth,
  params: serverParams,
  querystring: filePathQuery,
  response: fileErrorResponses,
}

/* CREATE DIRECTORY */
const createDirectoryBody = z.object({
  path: pathSchema.describe('Path of the new folder, its parent must exist'),
})

export type CreateDirectoryBody = z.infer<typeof createDirectoryBody>

export const createDirectorySchema: FastifySchema = {
  tags: TAGS,
  summary: 'Create a folder',
  security: bearerAuth,
  params: serverParams,
  body: createDirectoryBody,
  response: {
    201: fileEntrySchema,
    ...fileErrorResponses,
    409: errorResponseSchema.describe('Something already exists at this path'),
  },
}

/* CREATE FILE */
const createFileBody = z.object({
  path: pathSchema.describe('Path of the new file, its folder must exist'),
  // --> one character is at most 4 bytes, the use case checks the real size
  content: z.string().max(MAX_TEXT_FILE_BYTES).default('').describe('Text, up to 1 MB. Empty for an empty file'),
})

export type CreateFileBody = z.infer<typeof createFileBody>

export const createFileSchema: FastifySchema = {
  tags: TAGS,
  summary: 'Create a text file, an existing file is never replaced',
  security: bearerAuth,
  params: serverParams,
  body: createFileBody,
  response: {
    201: fileEntrySchema,
    ...fileErrorResponses,
    409: errorResponseSchema.describe('Something already exists at this path'),
  },
}

/* CHANGE PERMISSIONS */
const changeFilePermissionsBody = z.object({
  path: pathSchema,
  mode: z.string().regex(FILE_MODE_PATTERN, 'Three or four digits from 0 to 7, like "644"'),
})

export type ChangeFilePermissionsBody = z.infer<typeof changeFilePermissionsBody>

export const changeFilePermissionsSchema: FastifySchema = {
  tags: TAGS,
  summary: 'Change the rights of one file or folder (chmod), not of what a folder holds',
  security: bearerAuth,
  params: serverParams,
  body: changeFilePermissionsBody,
  response: {
    200: fileEntrySchema,
    ...fileErrorResponses,
  },
}
