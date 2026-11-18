/** Typed copy for the optional HTTP panel. */
import type {} from '@deepseek-ai/dsh-client-ui-slots'
/** Namespace for request controls and lifecycle feedback. */
export const NS = 'http-doc'
/** English dictionary and authoritative key set. */
export const en = {
  label: 'HTTP request', description: 'Send a request and generate reusable Markdown',
  method: 'Method', url: 'Request URL', headers: 'Request headers', query: 'Query parameters',
  name: 'Name', value: 'Value', add: 'Add row', remove: 'Remove row', body: 'Request body',
  title: 'Document title', send: 'Send request', sending: 'Sending…', close: 'Close',
  response: 'Markdown response', error: 'Request failed', unknown: 'The /http command is unavailable. Enable the HTTP documentation Host plugin.',
  invalidBody: 'Request body is not valid JSON. Correct the JSON or enter plain text.',
} as const
/** Keys owned by the HTTP request namespace. */
export type HttpDocKey = keyof typeof en
/** Chinese dictionary covering every English key. */
export const zh: Record<HttpDocKey, string> = {
  label: 'HTTP 请求', description: '发送请求并生成可复用的 Markdown 文档',
  method: '请求方法', url: '请求地址', headers: '请求头', query: '查询参数', name: '名称', value: '值',
  add: '添加行', remove: '移除行', body: '请求体', title: '文档标题', send: '发送请求', sending: '发送中…',
  close: '关闭', response: 'Markdown 响应', error: '请求失败',
  unknown: '/http 命令不可用，请启用 HTTP 文档 Host 插件。', invalidBody: '请求体不是有效的 JSON，请修正 JSON 或输入纯文本。',
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'http-doc': HttpDocKey }
}
