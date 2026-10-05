import { styleText } from 'node:util'
import { destination, type Logger as PinoLogger, pino } from 'pino'
import pretty from 'pino-pretty'
import { getEnv } from './config/env-manager.js'

type Color = Parameters<typeof styleText>[0]

export default class Logger {
  private static readonly LEVELS: Record<number, { name: string; emoji: string; color: Color }> = {
    10: { name: 'TRACE', emoji: '🔍', color: 'gray' },
    20: { name: 'DEBUG', emoji: '🐛', color: 'blue' },
    30: { name: 'INFO', emoji: '✨', color: 'green' },
    40: { name: 'WARN', emoji: '⚠️', color: 'yellow' },
    50: { name: 'ERROR', emoji: '❌', color: 'red' },
    60: { name: 'FATAL', emoji: '💀', color: ['bgRed', 'white'] },
  }

  private static readonly basePino: PinoLogger = Logger.createBasePino()

  private readonly pino: PinoLogger

  constructor(label?: string) {
    this.pino = label ? Logger.basePino.child({ label }) : Logger.basePino
  }

  public debug(message: string, data?: object): void {
    this.pino.debug(data ?? {}, message)
  }

  public info(message: string, data?: object): void {
    this.pino.info(data ?? {}, message)
  }

  public warn(message: string, data?: object): void {
    this.pino.warn(data ?? {}, message)
  }

  // --> error goes under "err" so pino prints its type, message and stack
  public error(message: string, error?: unknown, data?: object): void {
    this.pino.error({ ...data, err: error }, message)
  }

  public fatal(message: string, error?: unknown, data?: object): void {
    this.pino.fatal({ ...data, err: error }, message)
  }

  private static createBasePino(): PinoLogger {
    const isDev = getEnv('NODE_ENV') !== 'production'

    return pino(
      {
        level: isDev ? 'debug' : 'info',

        redact: {
          paths: [
            /* Redact request headers */
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers["set-cookie"]',
          ],
        },
      },

      // --> Development: readable colored lines with emojis, production: JSON lines for log tools
      isDev
        ? pretty({
            colorize: true,
            messageFormat: (log, messageKey) => Logger.formatLine(log, messageKey),
            // --> Already in formatLine (pino-pretty would add its own "[time] LEVEL (pid):" prefix)
            ignore: 'time,level,pid,hostname,label',
            // --> Write through process.stdout so Windows terminals show emojis correctly
            destination: process.stdout,
          })
        : destination(1),
    )
  }

  // --> Builds the whole development line: 02:31:12 INFO  ✨ [Redis] connected
  private static formatLine(log: Record<string, unknown>, messageKey: string): string {
    const level = Logger.LEVELS[log.level as number]
    if (!level) return String(log[messageKey])

    const time = styleText('gray', new Date(log.time as number).toLocaleTimeString('en-GB'))
    const name = styleText(level.color, level.name.padEnd(5))
    const label = log.label ? styleText('magenta', `[${log.label}] `) : ''

    return `${time} ${name} ${level.emoji} ${label}${log[messageKey]}`
  }
}
