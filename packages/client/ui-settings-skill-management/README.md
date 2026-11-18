---
description: "Manage user Skills and configure them independently for existing Agent presets from the DSH Web Plugins console."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-skill-management

English | [中文](README.zh.md)

## Summary

The **Plugins** entry in the Web sidebar lists DSH user Skills and read-only global Skills from shared Agent and configured custom directories. Open **Skills** to create or edit user Skills, copy a global Skill, or remove a user override. Select an existing Agent preset and choose which Skills that preset loads; no copied Agent preset is registered, and existing Sessions are unchanged.

## Table of Contents

- [Use This Package](#use-this-package)
- [Understand the Implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)


The **Plugins → Skills** page loads the catalog when opened and calls `ctx.remote.skillManagement.list/read/write/deleteSkill/select`. Each operation targets an existing Agent preset ID. The page checks every `RemoteResult.ok` before using its value. Global source files are never edited by the Client; editing one creates a DSH user-level copy.

The editor requires a name, description, and instruction body, with optional `whenToUse` guidance. Removing a user-level skill deletes only that personal definition; the global skill becomes visible again where one exists. Each Agent preset stores its own Skill allowlist, while the Skill documents remain shared across presets.

Enabling a preset or changing its allowlist affects Agents composed later; existing Agents keep their captured composition. If a file write commits but scope activation fails, the shell overlay reports the outcome and the page offers an Apply action that retries the selected preset. Operation outcomes use the app-wide overlay, so they remain visible after the Skills page closes.

## Understand the Implementation

The package owns the browser Plugins console contribution and its locale dictionaries. It is separate from `ui-skill`, which owns the conversation composer catalog. All mutations cross the generated `skillManagement` Remote; this package has no filesystem access and cannot write a global source.

## Further Exploration

- [Plugins manager](../ui-plugin-manager/README.md)
- [API remotes](../../api/remotes/README.md)
- [Skill filesystem provider](../../skill/skill-filesystem/README.md)

### Dev Note

The `./client` entry exports `apply` and `inject`, and registers the Skills page through the Plugins `plugins.item` slot. Operation Toasts register in `shell.overlay` and share an observable owned by the plugin fiber.

## Model Experience

None, as the page only edits Host-managed files and selects the preset for future Sessions without adding model-facing messages or tools.

#### KV Cache effect

The page itself changes no model input or cache prefix; skill consumers in the selected preset own the later model-visible content.

## Known Limitations and Deferred Work

- The global source roster and source identifiers are provided by the Host and are not configurable from this page.
