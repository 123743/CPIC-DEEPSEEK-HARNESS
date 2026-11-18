---
description: "A dashboard for community workflow runs and retry controls for pending or failed CPIC case-design runs, for gateway tenants."
kind: "package-bundle"
---

# Workflow run panel

English | [中文](README.zh.md)

## Summary

This standalone Cordis extension adds a sidebar page that reads the community `@dsh-external/workflow` run stores under `.dsh/workflow-runs` below `<rootDirectory>` and, when the CPIC requirements service is mounted, automatically includes its persisted case-design runs. It renders newest-first status summaries and per-run details, including CPIC stage progress and approved JSON artifacts. Community runs remain read-only. Recoverable case-design runs can retry through CPIC, which remains the source of truth; no workflow-store files are synthesized. The page also exposes the case-design pipeline template used by new runs for review and edit.

## Contents

- [Activate](#activate)
- [Use the panel](#use-the-panel)
- [Configure the source](#configure-the-source)
- [Execution and storage](#execution-and-storage)
- [Verification](#verification)
- [Model Experience](#model-experience)
- [Known limitations](#known-limitations)

<a id="activate"></a>
## Activate

The repository's [multi-user gateway launcher](../../scripts/multi-user/README.md#windows-web-deployment) mounts this source through its dedicated overlay for gateway-owned tenant processes. The community workflow plugin is required for file-backed runs; CPIC is optional, and its case-design runs appear automatically when the `cpicRequirements` service is mounted. Restart the gateway and its owned tenant processes after changing the launch composition, then refresh the authenticated gateway page. The panel can be mounted through any Loader composition the same way: register the Host module by absolute file URL and keep its `client.js` beside it. The package manifest must declare `dsh.client` with `platform: web` and export `./client`; the client-module scan discovers the bundle through that declaration and keys it by package name, so the `__ModuleLoader__.load` id inside `client.js` must equal the manifest `name`.

<a id="use-the-panel"></a>
## Use the panel

The sidebar button opens the workflow page. The list combines community workflow runs with CPIC case-design runs when that service is mounted; case-design rows are labeled and show committed-stage progress without requiring a separate command. A workspace selector filters the list; file-backed runs inherit the registered workspace matching their storage directory. Each request reads the currently mounted workspace and CPIC services, including services mounted after the panel. Runs are grouped by workspace and known session, with session groups ordered by their newest run and runs within each session ordered newest first. Session headings use the current title from the tenant's live or persisted session; Refresh picks up renames. If the session query service or a nonblank title is unavailable, the heading falls back to the session ID. Older records without a session ID remain individually time-sorted without a fabricated session heading. Selecting a community run opens its manifest, process graph, costs when cost metrics are available, artifacts, and a sequence diagram of the newest recorded events. The diagram draws Workflow-to-Agent arrows only for recorded agent start, completion, and message events with identifiable task data; other events appear as Workflow timeline notes. It preserves event order and does not infer unrecorded calls. Versioned graphs render recorded workflow containment, phase membership, and task-to-task evidence references declared by `task_id:` inputs; they do not imply that referenced tasks gate scheduling. Older snapshots retain their process-item list. Case-design details recorded before the pipeline model show the four ordered stages as a directed flow graph; runs carrying a pipeline definition show the six pipeline nodes instead, as described below. Their event list is reconstructed from persisted stage attempts and review checkpoints, without unrecorded timestamps or model interaction details. Artifacts appear as wrapping floating buttons, with the preview below the button group. Refresh reloads all views and rechecks the current workflow engine when it is available. An engine-owned run remains running; a persisted run from before the current process start that no longer has an active engine owner is shown as interrupted. A run that cannot be matched safely is shown as unconfirmed rather than being treated as stopped. Interrupted identifies a lost workflow owner; it does not confirm whether independently dispatched workers have settled. The detail heading emphasizes the workflow name and start/end times. The run list and detail metadata label started and active agent counts separately.

The workflow page also carries a Pipeline configuration entry outside the run list. Opening it loads the template used by new runs and lists the six pipeline nodes in order with their stage, actor role, workspace, bound skill, and Judge rule. Selecting a node opens an editor for the actor role, skill, and workspace plus the Judge role and rule; Save posts the edited definition to the CPIC service and refreshes the listing from the saved result. A failed save keeps the edits on screen with a localized error, and the Save button retries. When the mounted CPIC service does not expose pipeline configuration, the entry shows an unavailable state with a Retry action and the rest of the page keeps working. Saved edits apply to new runs only.

While a run detail remains open, the panel reloads its persisted snapshot every 2.5 seconds and keeps the latest successful detail visible between reads; terminal snapshots stop polling. Case-design details recorded with a pipeline show the nodes in order as execution cards: a localized node title that falls back to the node id for unknown ids, a status marker (completed, in progress, blocked, not started, unconfirmed), the attempt count, the latest Judge result with its issue list, the blocked reason on blocked nodes, and the committed artifact names. Selecting a node expands its judge checks with the actor, skill, and Judge roles and its stored output rendered by the JSON key/value tree with a raw JSON disclosure. Blocked nodes carry an emphasized status marker and their blocked reason. Runs without a pipeline field, and records whose pipeline is missing or incomplete, keep the legacy stage display. Version 2 process graphs render the recorded `node:<id>` chain with `next` edges; version 1 graphs keep the containment display. Run rows with the blocked status show a localized Blocked label and the run's blocking summary, and the case-design Retry action keeps its pending, failed, and cancelled semantics.

JSON result summaries render as a connected key/value tree, including nested objects and arrays; users can expand the raw JSON when needed. Non-JSON summaries remain plain text.

Every case-design run detail offers Traceability. The report uses that run's immutable snapshot and committed cleanup, features, scenarios and test cases, rather than the requirement's current text. The directed graph displays every committed item and adds an arrow for each actual adjacent-stage reference. Selecting an item highlights its cross-stage ancestors and descendants without highlighting sibling items from the same stage, and every other stage column scrolls to its first highlighted item while the selected item's column stays in place. Later stages appear as partial until committed. The tenant-local CPIC service performs the read-only analysis without model requests or record changes. A failed query retains the run details and offers a separate retry.

For a case-design run in pending, failed, or stopped (cancelled) state, Retry asks CPIC to advance once from its current saved checkpoint. A cancelled run can resume only while its original Session still has a live agent in the Host; the saved stage data remains authoritative. This can generate or review a stage and consume model tokens, but does not run every remaining stage. Success replaces the detail with the authoritative detail returned by CPIC. Failure keeps the displayed detail and shows a localized error; use Refresh to inspect the latest persisted state.

<a id="configure-the-source"></a>
## Configure the source

The Host module accepts three fields. `rootDirectory` is the absolute directory below which the panel reads community `.dsh/workflow-runs` stores, directly and one project-partition level down; the overlay sets it to each tenant process's working directory. CPIC runs are read from the mounted `cpicRequirements` service and do not depend on this directory. `maxEvents` bounds the events returned per workflow detail request (default 500, newest retained when the file is longer). `maxRuns` bounds the combined list (default 200, newest retained). File operations remain read-only and validate run IDs and artifact paths before opening files. Case-design retry delegates to the mounted CPIC service.

<a id="execution-and-storage"></a>
## Execution and storage

Each operation returns JSON over the tenant's authenticated HTTP route. Community runs are read from files; CPIC summaries and stage details are read from the CPIC service without exposing requirement text or storage paths. If a community snapshot still says running but its event log contains a terminal workflow event, the panel reports that terminal status and zero active agents without modifying stored files. When the current workflow service is available, refresh checks its workspace engine: an active run uses the engine snapshot, a terminal engine record overrides the file snapshot, and a run from before the current process start without an engine owner is reported as interrupted. Missing or unrecognized runtime state is reported as unconfirmed. CPIC artifact requests accept only JSON artifacts recorded for that run and enforce the panel's 1 MiB read limit. A missing workflow run directory returns an empty file-backed list; unreadable workflow snapshots are skipped, and malformed event lines do not fail a request. Community artifact paths must remain inside their run directory. Pipeline definitions are read and written through the CPIC service, which validates one complete replacement before saving it; a rejected update changes nothing. A detail carries the recorded pipeline only when every displayed field is present and well-typed, so incomplete records fall back to the legacy stage display instead of failing.

<a id="verification"></a>
## Verification

From the repository root, run the Host composition tests, the browser-module tests, and the tenant overlay regression. The in-process TypeScript source loader below is a test fixture, not an application launcher.

```powershell
node --import ./extensions/cpic-requirements/tests/fixtures/source-loader.mjs --test --experimental-test-isolation=none extensions/dsh-workflow-panel/tests/*.test.js
node --test scripts/multi-user/workflow-panel.test.js
```

The Host tests drive the real Loader and shared fetch handler against fixture stores and a CPIC service, covering list ordering, bounded event tails, run-id rejection, artifact containment, project-partition aggregation, CPIC list/detail/artifact routing without copied files, pipeline-configuration read/update routing with no partial saves, defensive pipeline details, client-module discovery, and invalid client-bundle declarations. The browser tests assert workflow and case-design list labels, stage progress, graph nodes and evidence-reference edges, legacy process-item rendering, detail, artifact preview, and error states, plus pipeline-configuration editing with save retries, six-node pipeline status and blocked display, expandable node checks and output, legacy pipeline fallback, and version-2 run graphs. The tenant overlay regression drives the same client bundle through jsdom.

<a id="model-experience"></a>
## Model Experience

The panel registers no model-facing tools or new session event types. Browsing and refreshing add no model requests or token cost. Reviewing or editing the pipeline configuration issues no model requests. Explicit case-design retry invokes CPIC advance once and can launch generation or review subagents, with the existing CPIC Session logging and model/token costs.

<a id="known-limitations"></a>
## Known limitations

The panel reads one `rootDirectory` and one project-partition level below it for community workflow files; CPIC runs are limited to records visible through the mounted tenant service. It does not stream progress; refresh reads persisted data and checks the current workflow engine when that service is available. CPIC event views are reconstructed from persisted stage attempts and review checkpoints; they do not contain timestamps or detailed model interactions, and CPIC has no model cost breakdown. The community event view keeps the newest `maxEvents` events and does not page through older ones. Artifact preview renders JSON only, without re-executing scripts. Community run control stays with its existing tools. Case-design retry cannot reconcile uncertain storage or restart completed runs. A cancelled run can resume only from its saved checkpoint while its original Session still has a live agent in the Host. Pipeline configuration edits change the actor and Judge fields of the loaded template and apply to new runs only; the panel cannot add, remove, reorder, or retarget nodes, and existing runs keep the pipeline snapshot recorded at their start.
