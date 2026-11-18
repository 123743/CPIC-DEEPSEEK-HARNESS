---
description: "Postman-style HTTP exchange tool for agent developers and maintainers choosing, configuring, or debugging request execution and automatic Markdown API documentation."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-tool-http-doc

English | [中文](README.zh.md)

## Summary

Use `http_request` to send one HTTP request, receive the response, and get the pair documented automatically: the tool returns the recorded exchange as structured data and as a reusable Markdown document with request headers, query parameters, request body, status code, response headers, and response body. The `/http` command exposes the same exchange to a person; it accepts a compact request line or a JSON request spec. The package is opt-in and adds one tool schema to every model request; deployment bounds set the call budget and capture cap.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this package when a model or a person should call HTTP APIs and produce API documentation from the exchange. The `http_request` tool serves model-authored calls; the `/http` command serves explicit human-authored calls. Add the optional Client package [`client-ui-http-doc`](../client-ui-http-doc/README.md) for a plus-menu request panel with a custom API icon.

### When to choose it

Choose it when a deployment wants Postman-style request building, response inspection, and documentation in one step — for example an agent that verifies an API against a running server and writes the verified request/response pair into the project's docs. Avoid it when only page content matters: `dsh-tool-web` fetches and converts web pages, without request bodies, custom headers, or a document projection.

### Composition

The package is opt-in: no shipped bundle mounts it, so a deployment enables it by adding the row to its composition and the package to its own workspace dependencies (`"@deepseek-ai/dsh-experimental-tool-http-doc": "workspace:*"`):

```yaml
- id: tool-http-doc
  name: '@deepseek-ai/dsh-experimental-tool-http-doc'
  config:
    requestTimeoutMs: 30000
    maxBodyChars: 200000
```

The plugin requires `tools` and `commands`; disposing it unregisters both contributions.

### Human command

Enter `/http GET https://example.com/api?limit=10` or `/http {"method":"POST","url":"https://example.com/api","headers":[{"name":"Accept","value":"application/json"}],"query":[],"body":{"name":"demo"},"title":"Create item"}`. The line form accepts optional `Name: value` header lines and a body after a blank line, or one inline body after the URL. A bare absolute URL defaults to GET. Object/array-looking bodies must be valid JSON; other body text is sent verbatim. Use the JSON request spec when a body starts with header-like text. The command returns Markdown in `command/done`, without scheduling a model request; invalid input, timeout and cancellation settle as errors. The optional Client panel supplies the JSON form automatically. Both entry points execute through the tool registry, so `tools/pre-execute` policy, guards and per-agent restrictions apply. Requests run on the Host and record supplied headers in the Session, including credentials.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `requestTimeoutMs` | `30000` | Cooperative call budget (ms), attached to the tool for the timeout policy and used as the transport's own deadline backstop |
| `maxBodyChars` | `200000` | Retained/echoed character cap for request and response bodies; response bodies are read fully before truncation |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-experimental-tool-http-doc) is the exhaustive source for every accepted field and its JSDoc.

### What the model can do

| Tool | What the model gets |
|---|---|
| `http_request` | One exchange: the sent request line, request headers, query parameters, and request body, the received status code, response headers, and response body as structured data, plus the same facts as a reusable Markdown API document in `markdown` |

The model builds requests the Postman way: an absolute `http(s)` URL, ordered `headers` and `query` name/value entries (duplicates keep their order and merge into the URL), and a `body` that is sent verbatim when it is a string and serialized as JSON otherwise. An optional `title` becomes the document heading. Bodies captured past `maxBodyChars` are cut and marked truncated in both the structured data and the document.

### Failures and recovery

Invalid input fails before anything is sent: a non-http URL, a malformed header name, control characters in a header value, an empty query name, or a body on `GET`/`HEAD` each returns one precise message. A transport failure, the request deadline, and caller cancellation are distinct: cancellation is preserved as the standard aborted tool error, the deadline reports the configured budget, and any other failure reports the transport message. A non-2xx response is a successful exchange — the status code is documented, not an error. Destination policy is supplied by the composition through tool policy; `tools/pre-execute` sees the initial URL, and cannot guarantee confinement of later redirect hops.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the tool and points at the code that realizes them; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

The package is built on one separation and three commitments:

- **One explicit resolve step.** `resolveRequest` turns validated arguments into an immutable request specification — URL parsing, query merging, header validation, body serialization, and the JSON content-type default happen there and nowhere else.
- **One transport boundary.** `sendRequest` performs the specification and records the exchange; the caller's signal and the deadline backstop both reach the wire, and only the recorded copies are capped.
- **One pure document projection.** `renderExchangeMarkdown` is a pure function of the recorded exchange, so the Markdown document is reproducible and unit-testable without a network.
- **Deployment bounds are Config, policy is not.** The call budget and capture cap are validated `Config` fields; request-destination and secret-handling policy stay in `tools/pre-execute` listeners where deployments own them.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config`, bound resolution, and tool/command registration |
| [`src/command.ts`](src/command.ts) | `/http` input grammars, request dispatch and Markdown result |
| [`src/request.ts`](src/request.ts) | Argument resolution, HTTP transport, exchange capture |
| [`src/markdown.ts`](src/markdown.ts) | Pure Markdown document projection |
| [`src/tool.ts`](src/tool.ts) | `http_request` schemas, canonical value, rendering, presentation |

### Operation flow

One call resolves its arguments into a request specification, sends it through the transport with the fused cancellation and deadline signals, and records the exchange: sent method, final URL, headers, query entries, and echoed request body on one side, status code, reason phrase, response headers, captured response body, content type, and duration on the other. The canonical value projects that exchange plus the Markdown document derived from it; the model-facing render is the document itself, and the replayable presentation metadata carries the summary a completed card shows.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the tool surface to the generated catalogs and the tool-authoring contract.

- [Generated tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-experimental-tool-http-doc) — the `http_request` schema as the model sees it.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-experimental-tool-http-doc) — every accepted `Config` field with its JSDoc.
- [Tool authoring reference](../../../docs/cookbook/adding-a-tool.md) — the execute, rendering, and presentation contracts the tool implements.
- [Cordis primer](../../../docs/cordis-primer.md) — plugin loading, effects, and configuration for the composition that mounts this package.

-----

<a id="model-experience"></a>
## Model Experience

### Tool schemas

#### What the model sees

The model sees the generated [`http_request` schema](../../../docs/tool-catalog.md#deepseek-aidsh-experimental-tool-http-doc): `method`, `url`, `headers`, `query`, `body`, and `title`. No timeout, output cap, or destination setting is model-visible.

#### Token effect

One fixed tool schema is sent on each request while the tool is visible.

#### KV Cache effect

Prefix-stable while tool visibility and the definition are unchanged.

### Tool results

#### What the model sees

Each successful call returns one text block: the Markdown API document, headed by the request line or the `title`, with stable `## Request` and `## Response` sections whose `### Request headers`, `### Query parameters`, `### Request body`, `### Response headers`, and `### Response body` parts render `_None._` or `_Empty response body._` when absent and note `_Body truncated by the configured capture cap._` when a captured body stopped early.

#### Token effect

Result text is data-dependent and stays in logged tool history until compaction; `maxBodyChars` bounds each captured body.

#### KV Cache effect

Append-only result text follows the reusable request prefix and does not invalidate earlier cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when this package is a poor fit or needs special operational care. They are current package constraints, not a task backlog.

- **One live exchange per document** — the document records the call that produced it; a changing endpoint yields a different document on the next call.
- **Retained bodies stop at the capture cap** — `maxBodyChars` bounds echoed output, while `response.text()` buffers the full response before truncation; it does not bound network traffic or peak response memory.
- **No built-in destination or secret policy** — supplied headers are documented verbatim; deployments provide tool policies for both model and human requests.
- **Automatic redirects** — the transport follows redirects; policy sees only the initial URL and cannot enforce per-hop confinement. The exchange retains the original request URL and final response without the redirect chain.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open design questions and directions that are not decided. It is explicitly non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above, the package code, and the linked Agent Notes.

#### Future: request collections

Postman's other core concept — saved, replayable request collections — is not here. Whether collections belong in this package, in a skill, or in workspace files is undecided.

</details>
