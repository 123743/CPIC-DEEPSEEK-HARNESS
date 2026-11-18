/**
 * Postman-style HTTP exchange tool: send one request, receive the response, and
 * get the pair documented as structured data plus a reusable Markdown API
 * document (request headers, query parameters, request body, status code,
 * response headers, response body). Deployment bounds are validated `Config`
 * fields; network-destination policy belongs in a `tools/pre-execute` listener.
 * @module @deepseek-ai/dsh-experimental-tool-http-doc
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { createHttpCommandHandler } from './command.ts'
import { createHttpDocTool } from './tool.ts'
import type { HttpDocToolConfig } from './tool.ts'

export { createHttpCommandHandler, HttpCommandInputError, HTTP_COMMAND_USAGE, parseHttpCommandInput } from './command.ts'
export { exchangeToValue, httpDocMetaFromResult, httpDocMetaFromValue, presentHttpCall, presentHttpResult } from './tool.ts'
export type { HttpDocMeta, HttpDocRequest, HttpDocResponse, HttpDocToolConfig, HttpDocValue, HttpToolArgs } from './tool.ts'
export { renderExchangeMarkdown } from './markdown.ts'
export type { MarkdownDocOptions } from './markdown.ts'
export { HTTP_METHODS, resolveRequest, sendRequest } from './request.ts'
export type {
  HttpExchange,
  HttpExchangeRequest,
  HttpExchangeResponse,
  HttpNameValue,
  HttpRequestInput,
  HttpRequestSpec,
  HttpTransport,
  SendRequestOptions,
} from './request.ts'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'tool-http-doc'

/** Registries required: the model-facing tool and the `/http` command. */
export const inject = ['tools', 'commands']

/** Default cooperative tool-call budget (ms) for one `http_request` call. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

/** Default capture cap (characters) for the echoed request body and the response body. */
export const DEFAULT_MAX_BODY_CHARS = 200_000

/** Smallest capture cap that still documents a useful body excerpt. */
export const MIN_MAX_BODY_CHARS = 256

/** Deployment-owned timeout and capture bounds for the HTTP documentation tool. */
export interface Config {
  /** Cooperative tool-call budget in milliseconds. Defaults to 30000. */
  requestTimeoutMs?: number
  /** Capture cap (characters) for the echoed request body and the response body. Defaults to 200000. */
  maxBodyChars?: number
}

/** Schemastery config for Loader defaults and generated configuration docs. */
export const Config: z<Config> = z.object({
  requestTimeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_REQUEST_TIMEOUT_MS),
  maxBodyChars: z.number().step(1).min(MIN_MAX_BODY_CHARS).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_BODY_CHARS),
})

/**
 * Validate one deployment bound and return it as a resolved integer at or above
 * its floor. The Loader runs this at plugin load so a misconfigured composition
 * fails loud.
 * @param field - configuration field name used in the violation.
 * @param value - configured bound.
 * @param min - smallest accepted value.
 * @returns The same bound once validated.
 * @throws When the bound is not an integer at or above `min`.
 */
function resolveBound(field: string, value: number, min: number): number {
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`tool-http-doc: ${field} must be an integer no smaller than ${min}, got ${JSON.stringify(value)}`)
  }
  return value
}

/**
 * Register the `http_request` tool and the `/http` command under the resolved
 * deployment bounds. Schemastery fills every defaulted `Config` field before
 * this runs; the resolve step still validates each bound so a direct `apply`
 * call fails loud as well. Both registrations are effects, so disposing the
 * plugin unregisters the tool and the command.
 * @param ctx - context whose `tools` and `commands` registries receive the registrations.
 * @param config - deployment-owned timeout and capture bounds.
 * @throws When a configured bound is invalid.
 */
export function apply(ctx: Context, config: Config): void {
  const toolConfig: HttpDocToolConfig = {
    requestTimeoutMs: resolveBound('requestTimeoutMs', config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS, 1),
    maxBodyChars: resolveBound('maxBodyChars', config.maxBodyChars ?? DEFAULT_MAX_BODY_CHARS, MIN_MAX_BODY_CHARS),
  }
  ctx.tools.register(createHttpDocTool(toolConfig))
  ctx.effect(() => ctx.commands.register({
    definitionId: CommandDefinitionId('@deepseek-ai/dsh-experimental-tool-http-doc'),
    name: 'http',
    description: 'Send one HTTP request and get the exchange documented as Markdown',
    input: { hint: 'GET https://api.example.com or {"method":"POST","url":"https://api.example.com","body":{}}' },
    handler: createHttpCommandHandler(async (args, invocation) => {
      const batch = await ctx.tools.execute({
        calls: [{
          type: 'tool-call',
          id: ToolCallId(`http:${invocation.commandId}`),
          name: 'http_request',
          arguments: JSON.stringify(args),
        }],
        agent: invocation.agent,
        signal: invocation.signal,
      })
      const result = batch.results[0]?.result
      if (!result) return { kind: 'error', text: 'HTTP request did not produce a tool result' }
      if (result.isError) return { kind: 'error', text: result.error.message }
      return {
        kind: 'success',
        text: result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n'),
      }
    }),
  }), 'tool-http-doc: /http command')
}
