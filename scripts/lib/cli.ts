/**
 * Shared plumbing for the command-line scripts: flags, the time zone, and turning a thrown
 * error into a plain message and a non-zero exit code instead of a stack trace.
 */
import { parseArgs, type ParseArgsConfig } from 'node:util'
import { defaultTimeZone } from '../../src/engine/dates.ts'

export type Options = NonNullable<ParseArgsConfig['options']>

const COMMON: Options = {
  data: { type: 'string' },
  tz: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
}

/** Parses argv with the common --data, --tz and --help flags added. Unknown flags are an error. */
export function parseFlags<T extends Options>(argv: readonly string[], options: T, allowPositionals = false) {
  return parseArgs({ args: [...argv], options: { ...COMMON, ...options }, allowPositionals, strict: true })
}

/** A valid IANA time zone from the flag or the TZ variable, else the runtime's zone. */
export function timeZoneFrom(flag: string | undefined): string {
  const zone = flag ?? process.env.TZ
  if (!zone) return defaultTimeZone()
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return zone
  } catch {
    throw new UsageError(`"${zone}" is not a time zone. Use a name such as America/Toronto.`)
  }
}

/** A mistake in how the script was called: printed with the usage text. */
export class UsageError extends Error {}

/** Runs a script's main function and exits with its code; errors print their message only. */
export function runMain(usage: string, main: () => Promise<number | void>): void {
  main().then(
    (code) => {
      process.exitCode = code ?? 0
    },
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      console.error(error instanceof UsageError || (error as { code?: string }).code?.startsWith('ERR_PARSE_ARGS') ? `${message}\n\n${usage}` : message)
      process.exitCode = 1
    },
  )
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}
