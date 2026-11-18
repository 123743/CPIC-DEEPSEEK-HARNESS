/**
 * Request resolution and transport for the HTTP documentation tool. Resolution
 * turns validated model arguments into one immutable request specification
 * (explicit defaulting, URL query merging, header validation); the transport
 * executes that specification and records the exchange that the Markdown
 * document derives from.
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'
import { TOOL_ABORTED } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** One ordered HTTP header or query entry kept exactly as requested. */
export interface HttpNameValue {
  /** Header or parameter name. */
  readonly name: string
  /** Header or parameter value. */
  readonly value: string
}

/** Model arguments accepted by the `http_request` tool. */
export interface HttpRequestInput {
  /** HTTP method, already narrowed to the supported set. */
  readonly method: string
  /** Absolute `http:` or `https:` request URL. */
  readonly url: string
  /** Request headers sent in the given order. */
  readonly headers?: readonly HttpNameValue[]
  /** Query parameters appended to the URL, duplicates allowed. */
  readonly query?: readonly HttpNameValue[]
  /**
   * Request body: a string is sent verbatim, any other lossless JSON value is
   * serialized as JSON with a `Content-Type: application/json` default.
   */
  readonly body?: JsonValue
}

/** A resolved request: exactly what the transport puts on the wire. */
export interface HttpRequestSpec {
  /** Upper-case HTTP method. */
  readonly method: string
  /** Final URL with every query parameter merged in. */
  readonly url: string
  /** Headers to send, including the applied body content-type default. */
  readonly headers: readonly HttpNameValue[]
  /** Query entries in the order they appear in the final URL. */
  readonly query: readonly HttpNameValue[]
  /** Complete wire body, or null when the request carries none. */
  readonly bodyText: string | null
}

/** The request half of one recorded exchange. */
export interface HttpExchangeRequest {
  /** Upper-case HTTP method. */
  readonly method: string
  /** Final request URL. */
  readonly url: string
  /** Request headers as sent. */
  readonly headers: readonly HttpNameValue[]
  /** Query parameters as sent, in URL order. */
  readonly query: readonly HttpNameValue[]
  /** Request body echoed up to the capture cap, or null when absent. */
  readonly body: string | null
  /** Whether the echoed request body stopped at the capture cap. */
  readonly bodyTruncated: boolean
}

/** The response half of one recorded exchange. */
export interface HttpExchangeResponse {
  /** Numeric status code. */
  readonly status: number
  /** Reason phrase, empty where the protocol carries none. */
  readonly statusText: string
  /** Response headers in protocol order. */
  readonly headers: readonly HttpNameValue[]
  /** Response body captured up to the capture cap. */
  readonly body: string
  /** Whether the captured response body stopped at the capture cap. */
  readonly bodyTruncated: boolean
  /** Response `Content-Type` without parameters, or null when absent. */
  readonly contentType: string | null
  /** Whole request/response duration in milliseconds. */
  readonly durationMs: number
}

/** One complete request/response exchange the Markdown document derives from. */
export interface HttpExchange {
  /** What was sent. */
  readonly request: HttpExchangeRequest
  /** What came back. */
  readonly response: HttpExchangeResponse
}

/** Pluggable HTTP transport; the default is the runtime `fetch`. */
export interface HttpTransport {
  /**
   * Perform one HTTP request.
   * @param url - final request URL.
   * @param init - request options, including the fused cancellation signal.
   * @returns the received response.
   */
  (url: string, init: RequestInit): Promise<Response>
}

/** Operational inputs for {@link sendRequest}. */
export interface SendRequestOptions {
  /** Caller-owned cancellation for the invocation. */
  readonly signal: AbortSignal
  /** Request deadline in milliseconds; it aborts the fetch on expiry. */
  readonly timeoutMs: number
  /** Capture cap applied to the echoed request body and the response body. */
  readonly maxBodyChars: number
  /** Transport override used by tests; defaults to the runtime `fetch`. */
  readonly fetch?: HttpTransport
}

/** The HTTP methods the tool accepts. */
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

/** Reject carriage returns, line feeds, and other control bytes in a header field. */
function hasControlBytes(value: string): boolean {
  return /[\u0000-\u0008\u000A-\u001F\u007F]/.test(value.replace(/\u0009/g, ''))
}

/** Validate one header name and value pair with an actionable violation. */
function validateHeader(header: HttpNameValue, index: number): void {
  if (!HEADER_NAME_PATTERN.test(header.name)) {
    throw new Error(`invalid headers[${index}].name: expected an HTTP token, got ${JSON.stringify(header.name)}`)
  }
  if (hasControlBytes(header.value)) {
    throw new Error(`invalid headers[${index}].value: control characters are not allowed in ${JSON.stringify(header.name)}`)
  }
}

/** Validate one query name and value pair. */
function validateQuery(query: HttpNameValue, index: number): void {
  if (query.name.length === 0) {
    throw new Error(`invalid query[${index}].name: expected a non-empty parameter name`)
  }
  if (query.value.includes('\u0000')) {
    throw new Error(`invalid query[${index}].value: NUL is not allowed in ${JSON.stringify(query.name)}`)
  }
}

/** Parse and constrain the request URL to absolute HTTP(S). */
function parseRequestUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`invalid url: expected an absolute http(s) URL, got ${JSON.stringify(raw)}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`invalid url: expected an http(s) URL, got ${JSON.stringify(url.protocol)} ${JSON.stringify(raw)}`)
  }
  return url
}

/** The default content type applied to a serialized JSON body. */
const JSON_CONTENT_TYPE = 'application/json'

/** Whether a header list already declares a content type (case-insensitive). */
function hasContentType(headers: readonly HttpNameValue[]): boolean {
  return headers.some(header => header.name.toLowerCase() === 'content-type')
}

/**
 * Resolve validated tool arguments into the exact request to send: parse the
 * URL, merge query parameters into it, validate every header field, and apply
 * the JSON body content-type default. Defaulting happens only here.
 * @param input - validated `http_request` arguments.
 * @returns The immutable request specification.
 * @throws When the URL, a header field, a query entry, or the body/method pairing is invalid.
 */
export function resolveRequest(input: HttpRequestInput): HttpRequestSpec {
  const method = input.method.toUpperCase()
  const url = parseRequestUrl(input.url)
  const headers = [...(input.headers ?? [])]
  headers.forEach(validateHeader)
  const query = [...(input.query ?? [])]
  query.forEach(validateQuery)
  for (const entry of query) url.searchParams.append(entry.name, entry.value)
  let bodyText: string | null = null
  if (input.body !== undefined) {
    if (method === 'GET' || method === 'HEAD') {
      throw new Error(`invalid body: ${method} requests cannot carry a body`)
    }
    if (typeof input.body === 'string') {
      bodyText = input.body
    } else {
      bodyText = JSON.stringify(input.body)
      if (!hasContentType(headers)) headers.push({ name: 'Content-Type', value: JSON_CONTENT_TYPE })
    }
  }
  return {
    method,
    url: url.toString(),
    headers,
    query: [...url.searchParams].map(([name, value]) => ({ name, value })),
    bodyText,
  }
}

/** Truncate captured body text to the capture cap and report whether it stopped early. */
function captureBody(text: string, maxBodyChars: number): { text: string; truncated: boolean } {
  return text.length > maxBodyChars
    ? { text: text.slice(0, maxBodyChars), truncated: true }
    : { text, truncated: false }
}

/**
 * The structured abort thrown when the caller cancels the tool call.
 *
 * @returns The cancellation error with the `TOOL_ABORTED` code and an `AbortError` name.
 */
export function toolAborted(): HarnessError {
  const error = new HarnessError('tool call aborted', TOOL_ABORTED)
  error.name = 'AbortError'
  return error
}

/** Classify one transport failure into the abort, timeout, or transport error it represents. */
function transportFailure(error: unknown, signal: AbortSignal, timeoutSignal: AbortSignal, timeoutMs: number): Error {
  if (signal.aborted) return toolAborted()
  if (timeoutSignal.aborted) return new Error(`request timed out after ${timeoutMs} ms`)
  const message = error instanceof Error ? error.message : String(error)
  return new Error(`request failed: ${message}`, { cause: error })
}

/**
 * Send one resolved request and record the complete exchange. The caller's
 * signal and a `timeoutMs` backstop both abort the fetch; the recorded request
 * body and response body stop at `maxBodyChars` while the wire body stays
 * complete. A non-2xx response is a successful exchange: only transport,
 * timeout, and cancellation failures throw.
 * @param spec - the resolved request to send.
 * @param options - cancellation, deadline, capture cap, and transport.
 * @returns The recorded request/response exchange.
 * @throws A cancellation {@link toolAborted}, a timeout error, or a transport error.
 */
export async function sendRequest(spec: HttpRequestSpec, options: SendRequestOptions): Promise<HttpExchange> {
  const timeoutSignal = AbortSignal.timeout(options.timeoutMs)
  const signal = AbortSignal.any([options.signal, timeoutSignal])
  const transport = options.fetch ?? globalThis.fetch
  const startedAt = Date.now()
  let response: Response
  try {
    const init: RequestInit = {
      method: spec.method,
      headers: spec.headers.map(header => [header.name, header.value]),
      redirect: 'follow',
      signal,
      ...(spec.bodyText === null ? {} : { body: spec.bodyText }),
    }
    response = await transport(spec.url, init)
    return recordExchange(spec, response, await response.text(), Date.now() - startedAt, options.maxBodyChars)
  } catch (error) {
    throw transportFailure(error, options.signal, timeoutSignal, options.timeoutMs)
  }
}

/** Assemble the recorded exchange from the sent specification and the received response. */
function recordExchange(
  spec: HttpRequestSpec,
  response: Response,
  text: string,
  durationMs: number,
  maxBodyChars: number,
): HttpExchange {
  const requestBody = captureBody(spec.bodyText ?? '', maxBodyChars)
  const responseBody = captureBody(text, maxBodyChars)
  const contentType = response.headers.get('content-type')
  return {
    request: {
      method: spec.method,
      url: spec.url,
      headers: spec.headers,
      query: spec.query,
      body: spec.bodyText === null ? null : requestBody.text,
      bodyTruncated: requestBody.truncated,
    },
    response: {
      status: response.status,
      statusText: response.statusText,
      headers: [...response.headers].map(([name, value]) => ({ name, value })),
      body: responseBody.text,
      bodyTruncated: responseBody.truncated,
      contentType: contentType === null ? null : contentType.replace(/;.*$/s, '').trim().toLowerCase(),
      durationMs,
    },
  }
}
