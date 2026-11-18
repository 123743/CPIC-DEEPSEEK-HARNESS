/** Strict field readers and file loading shared by the multi-user JSON configuration files. */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Require a plain JSON object.
 * @param value - parsed JSON value.
 * @param location - field path used in the failure message.
 * @returns the object itself.
 * @throws when `value` is not a plain object.
 */
export function requireRecord(value: unknown, location: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${location} must be an object`)
  return value
}

/**
 * Reject fields outside the schema's allowed set.
 * @param value - object read from a configuration file.
 * @param allowed - every field name the schema accepts.
 * @param location - field path used in the failure message.
 * @throws when the object carries a field outside `allowed`.
 */
export function rejectUnknownKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, location: string): void {
  const unknownKeys = Object.keys(value).filter(key => !allowed.has(key))
  if (unknownKeys.length > 0) throw new Error(`${location} has unknown field ${JSON.stringify(unknownKeys[0])}`)
}

/**
 * Require a non-blank string.
 * @param value - parsed JSON value.
 * @param location - field path used in the failure message.
 * @returns the string unchanged; callers that need a normalized copy normalize it themselves.
 * @throws when `value` is not a string or is blank.
 */
export function requireString(value: unknown, location: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${location} must be a non-empty string`)
  return value
}

/**
 * Read one UTF-8 JSON configuration file and parse it into its normalized form.
 * @param file - absolute or current-directory-relative JSON file path.
 * @param label - subject name used in every failure message, for example `static tenant configuration`.
 * @param parse - validation that returns the normalized configuration.
 * @returns the parsed configuration.
 * @throws with the resolved path when reading, JSON parsing, or validation fails.
 */
export async function loadJsonConfig<T>(file: string, label: string, parse: (value: unknown) => T): Promise<T> {
  const absolute = resolve(file)
  let text: string
  try {
    text = await readFile(absolute, 'utf8')
  } catch (error) {
    throw new Error(`cannot read ${label} ${JSON.stringify(absolute)}: ${String(error)}`, { cause: error })
  }
  let value: unknown
  try {
    // Windows editors and PowerShell write UTF-8 files with a leading BOM; JSON.parse rejects it.
    value = JSON.parse(text.replace(/^\uFEFF/u, ''))
  } catch (error) {
    throw new Error(`${label} ${JSON.stringify(absolute)} is not valid JSON: ${String(error)}`, { cause: error })
  }
  try {
    return parse(value)
  } catch (error) {
    throw new Error(`invalid ${label} ${JSON.stringify(absolute)}: ${String(error)}`, { cause: error })
  }
}
