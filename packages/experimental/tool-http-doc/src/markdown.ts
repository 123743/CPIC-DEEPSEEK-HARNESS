/**
 * Markdown document projection of one recorded HTTP exchange. The projection is
 * a pure function of the exchange: request line, request headers, query
 * parameters, request body, status code, response headers, and response body
 * always appear as stable sections, and absent parts are marked rather than
 * dropped.
 */

import type { HttpExchange, HttpExchangeRequest, HttpExchangeResponse, HttpNameValue } from './request.ts'

/** Options for {@link renderExchangeMarkdown}. */
export interface MarkdownDocOptions {
  /** Document title; defaults to the request line (`METHOD URL`). */
  readonly title?: string
}

/** Markdown fence languages keyed by MIME type. */
const FENCE_LANGUAGES: Readonly<Record<string, string>> = {
  'application/json': 'json',
  'application/javascript': 'javascript',
  'text/javascript': 'javascript',
  'text/html': 'html',
  'application/xhtml+xml': 'html',
  'text/xml': 'xml',
  'application/xml': 'xml',
  'text/markdown': 'markdown',
  'text/css': 'css',
}

/** Longest run of backticks in the text, so a fence can never collide with it. */
function longestBacktickRun(text: string): number {
  let longest = 0
  for (const run of text.matchAll(/`+/g)) longest = Math.max(longest, run[0].length)
  return longest
}

/** Fence a body block with a backtick run longer than any run inside it. */
function codeBlock(text: string, language: string | undefined): string {
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(text) + 1))
  return `${fence}${language ?? ''}\n${text}\n${fence}`
}

/** Escape one table cell: pipes escaped, line breaks collapsed to `<br>`. */
function tableCell(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('|', '\\|')
    .replaceAll(/\r\n|\r|\n/g, '<br>')
}

/** Render one two-column table, or a `_None._` marker when there are no rows. */
function nameValueTable(entries: readonly HttpNameValue[], leftHeading: string, rightHeading: string): string {
  if (entries.length === 0) return '_None._'
  const rows = entries.map(entry => `| ${tableCell(entry.name)} | ${tableCell(entry.value)} |`)
  return [`| ${leftHeading} | ${rightHeading} |`, '| --- | --- |', ...rows].join('\n')
}

/** The fence language for a body, derived from its content type. */
function bodyLanguage(contentType: string | undefined): string | undefined {
  if (contentType === undefined) return undefined
  const mime = contentType.replace(/;.*$/s, '').trim().toLowerCase()
  if (mime === 'application/json' || mime.endsWith('+json')) return 'json'
  if (mime === 'text/plain') return undefined
  return FENCE_LANGUAGES[mime]
}

/** Look up the content type a request or response declares. */
function declaredContentType(headers: readonly HttpNameValue[]): string | undefined {
  return headers.find(header => header.name.toLowerCase() === 'content-type')?.value
}

/** Render one body section with its truncation note. */
function bodySection(body: string | null, truncated: boolean, contentType: string | undefined, absent: string): string {
  if (body === null || body.length === 0) return absent
  const note = truncated ? '\n\n_Body truncated by the configured capture cap._' : ''
  return `${codeBlock(body, bodyLanguage(contentType))}${note}`
}

/** One-line status label: `200 OK`, or `204` where the protocol carries no reason phrase. */
function statusLabel(response: HttpExchangeResponse): string {
  return response.statusText.length === 0 ? `${response.status}` : `${response.status} ${response.statusText}`
}

/** Collapse a title to one heading line. */
function heading(title: string | undefined, request: HttpExchangeRequest): string {
  const fallback = `${request.method} ${request.url}`
  const collapsed = title?.replace(/\s+/g, ' ').trim()
  return collapsed === undefined || collapsed.length === 0 ? fallback : collapsed
}

/**
 * Render one exchange as a reusable Markdown API document. Every section is
 * stable: request headers, query parameters, and both bodies always appear, and
 * a missing part is rendered as `_None._` (or an absence note) so generated
 * documents keep one layout across calls.
 * @param exchange - the recorded request/response exchange.
 * @param options - document title selection.
 * @returns The complete Markdown document text.
 */
export function renderExchangeMarkdown(exchange: HttpExchange, options: MarkdownDocOptions): string {
  const { request, response } = exchange
  return [
    `# ${heading(options.title, request)}`,
    '## Request',
    [
      `- **Method:** \`${request.method}\``,
      `- **URL:** \`${request.url}\``,
    ].join('\n'),
    '### Request headers',
    nameValueTable(request.headers, 'Header', 'Value'),
    '### Query parameters',
    nameValueTable(request.query, 'Parameter', 'Value'),
    '### Request body',
    bodySection(request.body, request.bodyTruncated, declaredContentType(request.headers), '_None._'),
    '## Response',
    [
      `- **Status:** \`${statusLabel(response)}\``,
      `- **Duration:** \`${response.durationMs} ms\``,
    ].join('\n'),
    '### Response headers',
    nameValueTable(response.headers, 'Header', 'Value'),
    '### Response body',
    bodySection(response.body, response.bodyTruncated, response.contentType ?? undefined, '_Empty response body._'),
  ].join('\n\n')
}
