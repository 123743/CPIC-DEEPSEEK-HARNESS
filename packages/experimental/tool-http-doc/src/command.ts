/** Human HTTP commands return one recorded exchange as reusable Markdown. */

import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { HTTP_METHODS } from './request.ts'
import type { HttpNameValue } from './request.ts'
import type { HttpToolArgs } from './tool.ts'


/** Usage line appended to every `/http` input-validation failure. */
export const HTTP_COMMAND_USAGE =
  'usage: /http <METHOD> <url> [body] followed by optional "Name: value" header lines, '
  + 'or /http {"method":"GET","url":"https://example.com"}'

/** Failure raised for `/http` input the grammar cannot accept. */
export class HttpCommandInputError extends Error {}

/** Reported when a dispatched request settles because its invocation was canceled. */
const CANCELLED_TEXT = 'HTTP request cancelled.'

/** Allowed top-level fields of the JSON request-spec form. */
const SPEC_FIELDS = ['method', 'url', 'headers', 'query', 'body', 'title']

/** Header names of the line grammar (RFC 9110 token characters). */
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u

/** Absolute http(s) URL lookalike accepted as the line grammar's GET shorthand. */
const ABSOLUTE_URL = /^https?:\/\//u

/**
 * Whether a request-line token names one supported HTTP method.
 * @param token - the token to test, any case.
 * @returns whether the token is a supported method name.
 */
function isHttpMethod(token: string): boolean {
  return HTTP_METHODS.some(candidate => candidate === token.toUpperCase())
}

/**
 * Normalize a method token to the upper-case wire form.
 * @param method - method token in any case.
 * @returns the upper-case method name.
 * @throws {HttpCommandInputError} when the token names no supported method.
 */
function normalizeMethod(method: string): string {
  const upper = method.toUpperCase()
  if (!HTTP_METHODS.some(candidate => candidate === upper)) {
    throw new HttpCommandInputError(`unknown HTTP method "${method}"; use one of ${HTTP_METHODS.join(', ')}`)
  }
  return upper
}

/**
 * Split one line at its first whitespace run, preserving the rest verbatim.
 * @param line - line to split.
 * @returns the first token and the remaining text (empty when the line holds one token).
 */
function splitFirstToken(line: string): readonly [string, string] {
  const separator = line.search(/[ \t]/u)
  if (separator === -1) return [line, '']
  return [line.slice(0, separator), line.slice(separator).replace(/^[ \t]+/u, '')]
}

/**
 * Read one `Name: value` header line.
 * @param line - candidate line.
 * @returns the name and the value with surrounding whitespace removed, or `undefined` when the line is not a header line.
 */
function splitHeaderLine(line: string): readonly [string, string] | undefined {
  const separator = line.indexOf(':')
  if (separator <= 0) return undefined
  const name = line.slice(0, separator)
  if (!HEADER_NAME_PATTERN.test(name)) return undefined
  return [name, line.slice(separator + 1).replace(/^[ \t]+/u, '').trimEnd()]
}

/**
 * Interpret one request-body text: JSON when it opens an object or array,
 * otherwise a verbatim string body.
 * @param bodyText - the body text as written.
 * @returns the body value passed to {@link resolveRequest}.
 * @throws {HttpCommandInputError} when the text opens a JSON value but is not valid JSON.
 */
function parseBodyText(bodyText: string): JsonValue {
  const trimmed = bodyText.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return bodyText
  try {
    return JSON.parse(bodyText) as JsonValue
  } catch (error) {
    // JSON.parse throws SyntaxError; report the parser's own message.
    throw new HttpCommandInputError(`request body is not valid JSON: ${(error as Error).message}`)
  }
}

/**
 * Read one required string field of the JSON request spec.
 * @param value - the field's raw value, or undefined when absent.
 * @param field - field name used in the violation.
 * @returns the string value.
 * @throws {HttpCommandInputError} when the field is absent or not a non-empty string.
 */
function parseRequiredString(value: JsonValue | undefined, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new HttpCommandInputError(`request spec field "${field}" must be a non-empty string`)
  }
  return value
}

/**
 * Read one `{name, value}` list field of the JSON request spec.
 * @param value - the field's raw value, or undefined when absent.
 * @param field - field name used in the violation.
 * @returns the name/value pairs in spec order.
 * @throws {HttpCommandInputError} when the field is not a list of well-formed pairs.
 */
function parseNameValues(value: JsonValue | undefined, field: string): HttpNameValue[] {
  if (!Array.isArray(value)) {
    throw new HttpCommandInputError(`request spec field "${field}" must be an array of {name, value} objects`)
  }
  return value.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new HttpCommandInputError(`request spec field "${field}[${index}]" must be a {name, value} object`)
    }
    for (const key of Object.keys(entry)) {
      if (key !== 'name' && key !== 'value') {
        throw new HttpCommandInputError(`request spec field "${field}[${index}]" has unknown key "${key}"; use "name" and "value"`)
      }
    }
    if (typeof entry.name !== 'string' || typeof entry.value !== 'string') {
      throw new HttpCommandInputError(`request spec field "${field}[${index}]" needs string "name" and "value"`)
    }
    return { name: entry.name, value: entry.value }
  })
}

/**
 * Parse the JSON request-spec form of `/http` input.
 * @param text - the trimmed input, starting with `{`.
 * @returns the request arguments named by the spec.
 * @throws {HttpCommandInputError} when the spec is not valid JSON or violates the field grammar.
 */
function parseJsonSpec(text: string): HttpToolArgs {
  let spec: JsonValue
  try {
    spec = JSON.parse(text) as JsonValue
  } catch (error) {
    // JSON.parse throws SyntaxError; report the parser's own message.
    throw new HttpCommandInputError(`request spec is not valid JSON: ${(error as Error).message}`)
  }
  if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) {
    throw new HttpCommandInputError(`request spec must be a JSON object\n${HTTP_COMMAND_USAGE}`)
  }
  for (const field of Object.keys(spec)) {
    if (!SPEC_FIELDS.includes(field)) {
      throw new HttpCommandInputError(`unknown request spec field "${field}"; allowed fields: ${SPEC_FIELDS.join(', ')}`)
    }
  }
  return {
    method: normalizeMethod(parseRequiredString(spec.method, 'method')),
    url: parseRequiredString(spec.url, 'url'),
    ...spec.headers === undefined ? {} : { headers: parseNameValues(spec.headers, 'headers') },
    ...spec.query === undefined ? {} : { query: parseNameValues(spec.query, 'query') },
    ...spec.body === undefined ? {} : { body: spec.body },
    ...spec.title === undefined ? {} : { title: parseRequiredString(spec.title, 'title') },
  }
}

/**
 * Parse the line form of `/http` input: a request line `METHOD URL [body]`
 * (the method may be omitted before an absolute URL, defaulting to GET), then
 * `Name: value` header lines, then the block body after one optional blank
 * line. The body is written once — inline or blocked, never both — and a body
 * whose first line itself reads `Name: value` must use the JSON form instead.
 * The URL's own query string is not re-edited here.
 * @param text - the trimmed input.
 * @returns the request arguments named by the lines.
 * @throws {HttpCommandInputError} when the lines violate the grammar.
 */
function parseLineForm(text: string): HttpToolArgs {
  const lineBreak = text.indexOf('\n')
  const head = (lineBreak === -1 ? text : text.slice(0, lineBreak)).replace(/\r$/u, '')
  const rest = lineBreak === -1 ? '' : text.slice(lineBreak + 1)
  const lines = rest.length === 0 ? [] : rest.split(/\r?\n/u)
  const [first, afterFirst] = splitFirstToken(head)
  let method: string
  let urlToken: string
  let inlineBody: string
  if (isHttpMethod(first)) {
    const [url, body] = splitFirstToken(afterFirst)
    method = normalizeMethod(first)
    urlToken = url
    inlineBody = body
    if (urlToken.length === 0) {
      throw new HttpCommandInputError(`missing request URL after "${first}"\n${HTTP_COMMAND_USAGE}`)
    }
  } else if (ABSOLUTE_URL.test(first)) {
    method = 'GET'
    urlToken = first
    inlineBody = afterFirst
  } else {
    throw new HttpCommandInputError(
      `expected an HTTP method (${HTTP_METHODS.join(', ')}) or an absolute http(s) URL, got "${first}"\n${HTTP_COMMAND_USAGE}`,
    )
  }
  const headers: HttpNameValue[] = []
  const bodyLines: string[] = []
  let readingHeaders = true
  for (const line of lines) {
    const header = readingHeaders ? splitHeaderLine(line) : undefined
    if (header !== undefined) {
      headers.push({ name: header[0], value: header[1] })
      continue
    }
    readingHeaders = false
    bodyLines.push(line)
  }
  const firstBodyLine = bodyLines[0]
  if (firstBodyLine !== undefined && firstBodyLine.trim().length === 0) bodyLines.shift()
  const blockBody = bodyLines.join('\n')
  if (inlineBody.trim().length > 0 && blockBody.trim().length > 0) {
    throw new HttpCommandInputError('give the request body once — on the request line or after the header lines, not both')
  }
  const bodyText = inlineBody.trim().length > 0 ? inlineBody : blockBody
  return {
    method,
    url: urlToken,
    ...headers.length === 0 ? {} : { headers },
    ...bodyText.trim().length === 0 ? {} : { body: parseBodyText(bodyText) },
  }
}

/**
 * Parse one `/http` input into `http_request` tool arguments.
 * @param rawInput - exact text following the command name, separator whitespace included.
 * @returns the request arguments to resolve and send.
 * @throws {HttpCommandInputError} when the input violates the grammar.
 */
export function parseHttpCommandInput(rawInput: string): HttpToolArgs {
  const text = rawInput.trim()
  if (text.length === 0) throw new HttpCommandInputError(`missing request specification\n${HTTP_COMMAND_USAGE}`)
  return text.startsWith('{') || text.startsWith('[') ? parseJsonSpec(text) : parseLineForm(text)
}

/**
 * Build a `/http` command handler that parses input and delegates execution.
 * The registered command supplies an executor that uses the tool registry.
 * @param execute - executor for validated arguments and the original invocation.
 * @returns the command handler: parse and dispatch one exchange.
 */
export function createHttpCommandHandler(
  execute: (args: HttpToolArgs, invocation: CommandInvocation) => Promise<CommandResult>,
): (invocation: CommandInvocation) => Promise<CommandResult> {
  /** Parse one invocation's input, send the request, and document the exchange. */
  async function handleHttpCommand(invocation: CommandInvocation): Promise<CommandResult> {
    let args: HttpToolArgs
    try {
      args = parseHttpCommandInput(invocation.rawInput)
    } catch (error) {
      return { kind: 'error', text: (error as HttpCommandInputError).message }
    }
    try {
      return await execute(args, invocation)
    } catch (error) {
      if (invocation.signal.aborted) return { kind: 'error', text: CANCELLED_TEXT }
      return { kind: 'error', text: (error as Error).message }
    }
  }
  return handleHttpCommand
}
