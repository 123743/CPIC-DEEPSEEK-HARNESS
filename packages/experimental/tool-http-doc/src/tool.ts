/**
 * The `http_request` tool: one Postman-style HTTP call that returns the recorded
 * exchange as a canonical JSON value plus the reusable Markdown API document
 * derived from it. The module owns the argument schema, the canonical output
 * schema, the model-facing rendering, and the replayable UI presentation.
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, GenericResultView, ToolDefinition, ToolResult } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { renderExchangeMarkdown } from './markdown.ts'
import type { MarkdownDocOptions } from './markdown.ts'
import { HTTP_METHODS, resolveRequest, sendRequest } from './request.ts'
import type { HttpExchange, HttpNameValue, HttpRequestInput } from './request.ts'

/** Arguments accepted by the `http_request` tool. */
export interface HttpToolArgs extends HttpRequestInput {
  /** Document title for the generated Markdown; defaults to the request line. */
  readonly title?: string
}

/** The recorded request half of the canonical `http_request` value. */
export interface HttpDocRequest {
  /** Upper-case HTTP method. */
  readonly method: string
  /** Final request URL, including merged query parameters. */
  readonly url: string
  /** Request headers as sent. */
  readonly headers: HttpNameValue[]
  /** Query parameters as sent, in URL order. */
  readonly query: HttpNameValue[]
  /** Request body echoed up to the capture cap, or null when absent. */
  readonly body: string | null
  /** Whether the echoed request body stopped at the capture cap. */
  readonly bodyTruncated: boolean
}

/** The recorded response half of the canonical `http_request` value. */
export interface HttpDocResponse {
  /** Numeric status code. */
  readonly status: number
  /** Reason phrase, empty where the protocol carries none. */
  readonly statusText: string
  /** Response headers in protocol order. */
  readonly headers: HttpNameValue[]
  /** Response body captured up to the capture cap. */
  readonly body: string
  /** Whether the captured response body stopped at the capture cap. */
  readonly bodyTruncated: boolean
  /** Response `Content-Type` without parameters, or null when absent. */
  readonly contentType: string | null
  /** Whole request/response duration in milliseconds. */
  readonly durationMs: number
}

/** The canonical value one successful `http_request` call returns. */
export interface HttpDocValue {
  /** What was sent. */
  readonly request: HttpDocRequest
  /** What came back. */
  readonly response: HttpDocResponse
  /** The complete reusable Markdown API document derived from this exchange. */
  readonly markdown: string
}

/**
 * The `http_request` tool's private `tool/result` `meta` payload: the exchange
 * summary a UI shows on the completed card. Persisted with the session log so
 * replay reproduces the card without reparsing the Markdown document.
 */
export interface HttpDocMeta {
  /** Upper-case HTTP method. */
  method: string
  /** Final request URL. */
  url: string
  /** Numeric response status code. */
  status: number
  /** Response reason phrase, empty where the protocol carries none. */
  statusText: string
  /** Whole request/response duration in milliseconds. */
  durationMs: number
  /** Whether either captured body stopped at the capture cap. */
  truncated: boolean
}

const NAME_VALUE_PROPERTIES = {
  name: { type: 'string', required: true, description: 'Header or parameter name.' },
  value: { type: 'string', required: true, description: 'Header or parameter value.' },
} as const

const NAME_VALUE_ITEM = {
  type: 'object',
  additionalProperties: false,
  properties: NAME_VALUE_PROPERTIES,
} as const

/** Model-facing argument schema for the `http_request` tool. */
export const HTTP_REQUEST_PARAMETERS = {
  method: {
    type: 'string',
    required: true,
    enum: HTTP_METHODS,
    description: 'HTTP method to send.',
  },
  url: {
    type: 'string',
    required: true,
    description: 'Absolute http(s) request URL. Query parameters already present are kept.',
  },
  headers: {
    type: 'array',
    items: NAME_VALUE_ITEM,
    description: 'Request headers, sent in the given order. Header values may not contain control characters.',
  },
  query: {
    type: 'array',
    items: NAME_VALUE_ITEM,
    description: 'Query parameters appended to the URL; duplicates keep their order.',
  },
  body: {
    type: 'json',
    description: 'Request body. A string is sent verbatim; any other JSON value is serialized as JSON with a Content-Type: application/json default.',
  },
  title: {
    type: 'string',
    description: 'Title of the generated Markdown document. Defaults to the request line.',
  },
} as const

/** Canonical output schema for the `http_request` tool. */
export const HTTP_REQUEST_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    request: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        method: { type: 'string', required: true },
        url: { type: 'string', required: true },
        headers: { type: 'array', items: NAME_VALUE_ITEM, required: true },
        query: { type: 'array', items: NAME_VALUE_ITEM, required: true },
        body: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
        bodyTruncated: { type: 'boolean', required: true },
      },
    },
    response: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        status: { type: 'integer', required: true },
        statusText: { type: 'string', required: true },
        headers: { type: 'array', items: NAME_VALUE_ITEM, required: true },
        body: { type: 'string', required: true },
        bodyTruncated: { type: 'boolean', required: true },
        contentType: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
        durationMs: { type: 'number', required: true },
      },
    },
    markdown: { type: 'string', required: true },
  },
} as const

/** Tool description sent to the model. */
export const HTTP_REQUEST_DESCRIPTION =
  'Send one HTTP request and capture the response. Returns the recorded exchange (request line, request headers, '
  + 'query parameters, request body, status code, response headers, response body) as structured data plus a '
  + 'reusable Markdown API document in `markdown`. Use it to exercise HTTP APIs and to document them from live '
  + 'calls. Response bodies are captured up to the deployment cap and marked truncated.'

/**
 * Build the canonical value from one recorded exchange: the structured request
 * and response plus the Markdown document derived from them.
 * @param exchange - the recorded request/response exchange.
 * @param options - document title selection.
 * @returns The canonical `http_request` value.
 */
export function exchangeToValue(exchange: HttpExchange, options: MarkdownDocOptions): HttpDocValue {
  return {
    request: {
      ...exchange.request,
      headers: [...exchange.request.headers],
      query: [...exchange.request.query],
    },
    response: {
      ...exchange.response,
      headers: [...exchange.response.headers],
    },
    markdown: renderExchangeMarkdown(exchange, options),
  }
}

/**
 * Project a canonical `http_request` value into its replayable presentation
 * meta.
 * @param value - the canonical `http_request` output value.
 * @returns The method, URL, status, duration, and capture truncation of the exchange.
 */
export function httpDocMetaFromValue(value: HttpDocValue): JsonValue {
  return {
    method: value.request.method,
    url: value.request.url,
    status: value.response.status,
    statusText: value.response.statusText,
    durationMs: value.response.durationMs,
    truncated: value.request.bodyTruncated || value.response.bodyTruncated,
  }
}

/**
 * Narrow opaque live or replayed result metadata to an {@link HttpDocMeta}.
 * Malformed metadata returns `undefined` so presentation falls back to the
 * generic card instead of throwing during replay.
 * @param meta - result metadata as carried on `tool/result`.
 * @returns The validated exchange summary, or `undefined` for absent or malformed data.
 */
export function httpDocMetaFromResult(meta: unknown): HttpDocMeta | undefined {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return undefined
  const { method, url, status, statusText, durationMs, truncated } = meta as Record<string, unknown>
  if (typeof method !== 'string' || typeof url !== 'string' || typeof status !== 'number') return undefined
  if (typeof statusText !== 'string' || typeof durationMs !== 'number' || typeof truncated !== 'boolean') return undefined
  return { method, url, status, statusText, durationMs, truncated }
}

/** The salient call identity both presentations share: the request line. */
function requestLine(args: Pick<HttpToolArgs, 'method' | 'url'>): string {
  return `${args.method} ${args.url}`
}

/**
 * Present one pending call as a generic card titled by the request line.
 * @param args - the validated tool arguments; only `method` and `url` feed the view.
 * @returns The generic call view shown while the request runs.
 */
export function presentHttpCall(args: HttpToolArgs): GenericCallView {
  return { card: 'generic', title: requestLine(args), kind: 'fetch', rawInput: requestLine(args) }
}

/**
 * Present one completed call as a generic card carrying the exchange summary
 * from result metadata; the Markdown document itself stays in the result content.
 * @param args - the validated tool arguments.
 * @param result - the final model-facing tool result.
 * @returns The generic result view, or `undefined` (generic fallback) on failure or malformed metadata.
 */
export function presentHttpResult(args: HttpToolArgs, result: ToolResult): GenericResultView | undefined {
  if (result.isError) return undefined
  const meta = httpDocMetaFromResult(result.meta)
  if (meta === undefined) return undefined
  const status = meta.statusText.length === 0 ? `${meta.status}` : `${meta.status} ${meta.statusText}`
  const truncation = meta.truncated ? '; body truncated by the capture cap' : ''
  return {
    card: 'generic',
    title: requestLine(args),
    content: [{ type: 'text', text: `${status} (${meta.durationMs} ms${truncation})` }],
  }
}

/** Resolved plugin configuration one registered tool executes under. */
export interface HttpDocToolConfig {
  /** Cooperative tool-call budget in milliseconds. */
  readonly requestTimeoutMs: number
  /** Capture cap applied to the echoed request body and the response body. */
  readonly maxBodyChars: number
}

/**
 * Build the registered `http_request` tool under one resolved configuration.
 * The cooperative budget rides `ToolDefinition.timeoutMs` for
 * `@deepseek-ai/dsh-tool-call-timeout-policy` and doubles as the transport's own
 * deadline backstop; the capture cap bounds both recorded bodies.
 * @param config - resolved timeout and capture bounds.
 * @returns The registry-ready tool definition.
 */
export function createHttpDocTool(config: HttpDocToolConfig): ToolDefinition {
  return defineTool({
    name: 'http_request',
    description: HTTP_REQUEST_DESCRIPTION,
    parameters: HTTP_REQUEST_PARAMETERS,
    output: {
      schema: HTTP_REQUEST_OUTPUT,
      render(_args: HttpToolArgs, value: HttpDocValue): ContentBlock[] {
        return [{ type: 'text', text: value.markdown }]
      },
      presentationMeta(_args: HttpToolArgs, value: HttpDocValue): JsonValue {
        return httpDocMetaFromValue(value)
      },
    },
    timeoutMs: config.requestTimeoutMs,
    isConcurrencySafe(): boolean {
      return true
    },
    presentCall: presentHttpCall,
    presentResult: presentHttpResult,
    async execute(args: HttpToolArgs, exec): Promise<HttpDocValue> {
      const spec = resolveRequest(args)
      const exchange = await sendRequest(spec, {
        signal: exec.signal,
        timeoutMs: config.requestTimeoutMs,
        maxBodyChars: config.maxBodyChars,
      })
      return exchangeToValue(exchange, { ...args.title === undefined ? {} : { title: args.title } })
    },
  })
}
