export interface ParsedArguments {
  positionals: string[]
  flags: Record<string, string | boolean>
}

const BOOLEAN_FLAGS = new Set([
  "confirm",
  "continue-on-failure",
  "detach",
  "help",
  "include-existing",
  "json",
  "no-animated",
  "no-snapshot",
  "version",
])

export function parseArguments(argv: string[]): ParsedArguments {
  const args = argv[0] === "agent" ? argv.slice(1) : [...argv]
  const positionals: string[] = []
  const flags: Record<string, string | boolean> = {}

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]
    if (!value.startsWith("--")) {
      positionals.push(value)
      continue
    }

    const [rawName, inlineValue] = value.slice(2).split(/=(.*)/s, 2)
    if (inlineValue !== undefined) {
      flags[rawName] = inlineValue
    } else if (BOOLEAN_FLAGS.has(rawName)) {
      flags[rawName] = true
    } else {
      const next = args[index + 1]
      if (next === undefined || next.startsWith("--")) {
        throw new Error(`--${rawName} requires a value.`)
      }
      flags[rawName] = next
      index += 1
    }
  }

  return { positionals, flags }
}

export function stringFlag(args: ParsedArguments, name: string): string | undefined {
  const value = args.flags[name]
  return typeof value === "string" ? value : undefined
}

export function requiredFlag(args: ParsedArguments, name: string): string {
  const value = stringFlag(args, name)
  if (value === undefined) throw new Error(`--${name} is required.`)
  return value
}

export function requiredPositional(args: ParsedArguments, index: number, label: string): string {
  const value = args.positionals[index]
  if (!value) throw new Error(`${label} is required.`)
  return value
}

export function numberFlag(args: ParsedArguments, name: string): number | undefined {
  const raw = stringFlag(args, name)
  if (raw === undefined) return undefined
  const value = Number(raw)
  if (!Number.isFinite(value)) throw new Error(`--${name} must be a number.`)
  return value
}

export function jsonFlag(args: ParsedArguments, name: string, fallback: unknown = {}): unknown {
  const raw = stringFlag(args, name)
  if (raw === undefined) return fallback
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error(`--${name} must be valid JSON.`)
  }
}
