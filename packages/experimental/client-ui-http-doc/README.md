---
description: "Optional HTTP request editor and reusable Markdown response panel for Harness users and plugin maintainers."
kind: "package-reference"
---

# HTTP request panel

English | [中文](README.zh.md)

Reference for the optional `@deepseek-ai/dsh-experimental-client-ui-http-doc` Client plugin. It contributes **HTTP request** (`/http-request`) with an API icon to the composer plus menu. A bare `/http` also opens the panel; `/http` with arguments keeps the Host command's normal behavior.

## Enable

Mount this package alongside `@deepseek-ai/dsh-experimental-tool-http-doc` in a local profile patch. Build the Client bundle before starting the profile. This experimental package is opt-in and is absent from shipped compositions.

```yaml
- insert:
    - id: client-ui-http-doc
      name: '@deepseek-ai/dsh-experimental-client-ui-http-doc'
```

The panel edits method, absolute URL, ordered headers, repeated query parameters, body and document title. Send invokes `/http` with a JSON specification through the commands Remote. Object and array bodies must contain valid JSON; other bodies are sent as text. Empty name/value rows are omitted. Markdown is shown as selectable source in the panel and remains in the command's conversation result. Errors keep the draft editable. Closing or reopening aborts the request; late completions cannot update another opening. Plugin disposal cancels and awaits active requests.

Drafts are scoped to the Session in memory and survive overlay remounts. They are not written to browser storage. Headers may contain secrets; the Host command's logging and network policies apply to the submitted request.

## Source map

- [Client registration](src/client/index.ts) owns menu, locale and overlay contributions.
- [Draft store](src/client/draft-store.ts) owns editable fields; [controller](src/client/controller.ts) owns opening and cancellation.
- [Panel](src/client/RequestPanel.tsx) consumes only framework-bound props.

## Model Experience

### Direct command execution

#### What the model sees

No prompts, tools, or model messages are added by this Client plugin. Requests go directly to the Host command.

#### Token effect

No model tokens are consumed by panel interaction. The Host command records the exchange using its own policy.

#### KV Cache effect

The plugin does not change model request assembly or invalidate an already-reusable prefix.

## Known Limitations and Deferred Work

The shared composer groups custom contributions under Commands, including when opened through the plus button. The Host `/http` row and the icon-bearing `/http-request` row both remain available. One panel opening is active per browser plugin instance. A blank Session containing only commands keeps the welcome view; read or copy Markdown in the panel before closing it. The command result remains in the Session log and appears in the conversation when the Session has other content. Markdown is displayed as source for reuse; collection management, authentication presets, file uploads, history and response visualizers are outside this package. Sending requires the matching Host `/http` command; a missing command produces an actionable error.
