---
description: "CPICHarness requirement analysis and manual QA using completed case designs."
kind: "package-bundle"
---

# CPICHarness Requirement Workbench

English | [中文](README.zh.md)

## Summary

Import Markdown or text requirements, generate traceable case designs, then send completed testcase plans to CPIC-oa for manual approval, execution and defect tracking.

## Contents

- [Activate](#activate)
- [Configure the source](#configure-the-source)
- [Use the workbench](#use-the-workbench)
- [Traceability analysis](#traceability-analysis)
- [Case-design pipeline](#case-design-pipeline)
- [CPIC-oa Quality Console](#cpic-oa-quality-console)
- [Execution and storage](#execution-and-storage)
- [Verification](#verification)
- [Model Experience](#model-experience)
- [Known limitations](#known-limitations)

<a id="activate"></a>
## Activate

The repository's [multi-user Gateway launcher](../../scripts/multi-user/README.md#windows-web-deployment) mounts this extension through a dedicated overlay. Restart the Gateway and its tenant processes after changing the launch composition, then refresh the authenticated page.

Install this directory as a bundle through Harness Plugin Manager. The patch sets the requirements root to each tenant workspace; a separately running desktop Harness remains unchanged. The Host must provide storageDomain, fs, workspaceRegistry, sessionController, connection, tools, subagents, agents, credentials, skills, persona, file and question tool services. The extension registers its `cpic-case-design` child-agent provider.

<a id="configure-the-source"></a>
## Configure the source

The requirement source and QA records are served by XTEST's internal CPIC HTTP API. The Host can call `POST /projects/list` with `{}` to retrieve the bound user's assigned projects as `{ p_sid, p_name }` rows, independently of requirement records; XTEST applies authorization from the trusted identity headers. The browser receives neither the API URL nor its secret.

Configure the server-only `database.apiUrl` as the XTEST CPIC API root ending in `/api/dsh/internal/cpic`, with `database.apiSecret`, `database.userIdentity` and `database.tenantId`. Gateway injects the URL and secret into each tenant process; the user and tenant headers come from the server-side tenant registry. Missing configuration or trusted tenant identity stops Host startup. Use HTTPS for non-loopback XTEST endpoints. The browser never receives this URL or secret. XTEST reads and writes the existing `cpic_qa_*` records; no automatic migration or public legacy migration endpoint is provided. Bounded XTEST business failure messages are retained after the Host error code so administrators can diagnose server configuration or database failures. Requirement body saves use the current body hash for conditional updates; conflicting edits are rejected and require a refresh.

<a id="use-the-workbench"></a>
## Use the workbench

Open Requirement analysis and select Import Markdown to open a modal. The dialog groups metadata above a separate file picker and full-width Markdown editor, with a sticky footer for closing or importing; metadata fields stack in narrow windows. Choose an authorized system by name, load a `.md`/`.txt` file or edit the Markdown in Vditor, then submit the import. The workbench loads authorized project rows through the authenticated `projects` action on `/api/cpic.requirements`; the import dialog and system filter use the same `{ p_sid, p_name }` list, including projects with no requirements. Empty lists are valid, and malformed or oversized responses fail. A project-list failure leaves the requirements visible, offers retry, and disables system selection until the list loads. Source, system and stable ID determine workspace identity. New tenant-local Markdown imports save the selected system ID in `p_sid` and its name in `p_name`, alongside `system` and `systemName` for workbench reads; existing records are not backfilled. The requirement list combines authorized XTEST requirements with tenant-local imports. Legacy local requirements whose source is `ta4cpic` are deleted from requirement storage when the workbench starts, and new imports from that source are rejected; existing analysis runs and immutable snapshots are retained. The list displays the XTEST system name while retaining the system ID only for stable identity and Host requests; use the compact requirement search and system selector to filter the authorized results. System labels prefer `p_name` in XTEST responses and tenant-local records, then use `systemName` or the XTEST `projectName`; the system ID remains the fallback when no name is available. Select a requirement to inspect its body; use the Vditor Markdown editor, which opens in WYSIWYG mode by default, to edit and preview the source, switch editing modes or enter fullscreen when needed, then save the Markdown source. The editor uses the shell's Vditor 3.11.3 implementation with the complete bundled 3.11.3 distribution at authenticated same-origin `/api/cpic.assets/vditor/3.11.3`; editing requires no public CDN. `/api/cpic.editor` publishes the version and resource base. `editorAssets.directory` may select an absolute directory containing the same-version `package.json` and complete `dist`; `editorAssets.baseUrl` may select a same-origin path or HTTP(S) resource root serving that same version. XTEST 3.11.2 resources cannot be mixed with this implementation. Missing required local files or an incompatible manifest stops startup; editor configuration or stylesheet failures display an editor alert. The Host sends a conditional update to XTEST using project authorization and the current body hash. Saved content is used by later analysis preparation; an already prepared analysis keeps its immutable snapshot. Browsing creates no workspace, Session or model request. Preparation writes an immutable snapshot, creates a case-design Session and initializes its draft. The workspace and Session are named `<requirement title> - <requirement ID>`. The Session composer opens Project radar in the right sidebar, where the current run status, stage, committed requirement/feature/scenario/testcase counts and available artifacts are shown as wrapping floating buttons. Selecting any artifact opens it in the sidebar resource viewer. Active runs refresh automatically. Send the draft or select Start analysis.

<a id="traceability-analysis"></a>
## Traceability analysis

The session Project radar reads the run bound to the currently open Session and reports committed stages from its persisted run record; a terminal status alone does not mark uncommitted stages complete. Open any case-design run in the [workflow panel](../dsh-workflow-panel/README.md#use-the-panel) and select Traceability. The CPIC service supplies that run's fixed snapshot and committed stage data for read-only validation; the requirement list has no traceability action. The report checks the committed stage prefix immediately and marks later uncommitted stages as partial instead of hiding the action. Its graph displays every committed item and adds an edge for each actual adjacent-stage reference: feature `requirementIds`, scenario `featureIds` and testcase `scenarioIds`. Selecting an item highlights its cross-stage ancestors and descendants without highlighting sibling items from the same stage, and every other stage column scrolls to its first highlighted item while the selected item's column stays in place.

A newly requested analysis uses a new request ID; one workspace can retain separate runs. The browser generates preparation IDs with `crypto.getRandomValues`, including on HTTP intranet origins. A preparation failure leaves the action available for retry and displays an error. Retrying with the same request ID reuses its Session and snapshot. Changed content or version creates another immutable snapshot. Preparation stops when an associated directory is missing or a path is occupied by unrelated content; it never silently recreates or moves a workspace.

The [case-design pipeline](#case-design-pipeline) executes the four stages cleanup, features, outline and testcases as six serial nodes. Each stage artifact has a program-generated object `id`; `sourceRefs` separately contains one-based line ranges into the immutable snapshot. Never use an object ID as a line number or reference a line outside the snapshot. A gap that could change behavior, coverage, preconditions or expected results blocks later stages until the user answers through `clarify`. The user can authorize the model to propose a clearly marked `Model judgment - pending confirmation` interpretation for listed gaps; these proposals are not confirmed requirement facts. Changed input after generation requires a new analysis.

<a id="case-design-pipeline"></a>
## Case-design pipeline

Case-design runs execute a serial six-node pipeline over the four stages cleanup, features, outline and testcases: `clarify` and `extract` generate the cleanup and features stages, `outline-gen` generates and `outline-review` reviews the outline stage, and `case-gen` generates and `case-review` reviews the testcases stage. Each node names one actor role with one bound skill and one role workspace, plus one independent judge that verifies the node output against the node's gate rule and records the node's check; the judge never rewrites the output and never approves its own generation. A stage commits only after every one of its node checks passes in pipeline order.

Every node runs under its own `case-role-<role>` Agent preset: a role persona, a skill provider scoped to exactly one role workspace skill directory, and a role guard. The guard re-admits the global `skill` tool by name only for actor roles and accepts only their bound skill at execution, so a role discovers and loads exactly its own procedure; judge roles receive no skill. The six bundled role procedures are seeded create-if-absent as `SKILL.md` under `<rootDirectory>/workspaces/<workspace>/.dsh/skills/`, and an existing file wins so a deployment can customize a role procedure.

A failed judge check rejects the attempt. The stage reopens for revision while its attempts stay below `maxAttempts` plus granted revisions, then blocks; `case_design` `unblock` with the user's explicit reason reopens a blocked stage for exactly one more revision per grant and records the reason on the stage, and a blocked node stays blocked until then. A pipeline run ends `completed` or `blocked`: an exhausted review no longer commits a candidate with issues, so `completed_with_issues` never occurs.

The effective template is the validated YAML definition [pipeline.yaml](pipeline.yaml) (schema version 2, serial mode) or the file selected by `pipelinePath`. The `cpicRequirements` service reads and replaces it through `getPipelineConfig` and `updatePipelineConfig`, which validate one complete node list and reject an invalid replacement without saving; edits affect new runs only because each run snapshots the effective definition at start. The [workflow panel](../dsh-workflow-panel/README.md#use-the-panel) shows each run's node states and a pipeline configuration editor. Runs recorded before the pipeline model carry no pipeline definition and keep the four-stage execution semantics they were recorded under; the storage declaration `compatibleVersions: [1]` keeps them readable without migration, and nothing rewrites them.

Case-design task data is bounded by `maxTaskInputBytes` (16000 UTF-8 bytes); the assembled task prompt is bounded by `maxTaskPromptBytes` (32768 bytes), excluding the provider's system prompt and tool schemas. Cleanup prefers Markdown paragraph and heading boundaries and retains original line numbers; later stages group at most `maxBatchItems` (4) upstream items and include their linked ancestors and cited source lines. Independent reviews and judges inspect every output portion. The Host validates the aggregate's IDs, source references and coverage before committing it. A model `max-tokens` result causes the affected portion to split and retry with smaller input; a single indivisible item that still fails stops with `MODEL_OUTPUT_LIMIT`. Partial structured JSON is never accepted or concatenated. `maxOutputBytes` bounds the combined stage artifact. These byte budgets do not guarantee a model token count; operators must allow room for its tokenizer, role procedure, system prompt and tools. Chunked tasks have limited cross-section context, so users must review document-wide rules and contradictions.

`stageTimeoutMs` (900000 milliseconds) bounds one advance operation, including all of its portions and checks. A deadline reports `STAGE_TIMEOUT` and leaves the last committed checkpoint retryable; explicit cancellation still cancels the run. The normal chat output-limit notice means the model exhausted its output budget; users can send Continue for prose, while case-design structured tasks recover by subdivision.

<a id="cpic-oa-quality-console"></a>
## CPIC-oa Quality Console

Gateway tenant processes load CPIC-oa through the discovered browser entry. The console imports completed case-design runs as versioned testcase plans after validating immutable snapshots and testcase data. The Host checks review versions, execution authorization, defect states and project gates; client fields do not grant authorization. Requirement lists and details are authorized by XTEST for the bound user and assigned project.

QA projects, plans, manual execution records, defects and audits are stored by XTEST in the existing `cpic_qa_projects`, `cpic_qa_plans`, `cpic_qa_executions`, `cpic_qa_defects` and `cpic_qa_audits` records. Every read and write is scoped by the trusted tenant ID supplied by Gateway. Existing rows remain in place; no copy or deletion is performed during startup.

Evidence consists of a text note or workspace-file reference; the console does not upload attachments. It does not provide browser automation, cross-tenant sharing, team roles, automatic publication or XTEST source-data write-back.

The separate dsh-qa workbench stores project data in local JSON files and its built-in Host proxy accepts loopback requests only. Gateway tenants use CPIC-oa’s authenticated Host operations and tenant-keyed records stored by XTEST instead; dsh-qa’s broader dashboard is not mounted as a remote tenant UI.

<a id="execution-and-storage"></a>
## Execution and storage

Case design runs and requirement snapshots remain in the local `cpic_requirements` storage domain and tenant workspace. QA records are stored only in XTEST QA tables. A completed run requires all stages and their required reviews or judge checks to pass, valid testcase JSON and matching read-back of final files. An interrupted or uncertain run is not automatically replayed after process restart. Explicit retry resolves the recorded top-level Session through the Host session controller when it is not live, then continues only a recoverable pending, failed or cancelled checkpoint.

The adapter loads tenant records from XTEST and uses server SHA-256 hashes for conditional updates and deletes. Audit records are append-only. XTEST owns database access, project authorization and tenant isolation.

<a id="verification"></a>
## Verification

Run the tests from this extension directory:

```powershell
pnpm test
```

Tests use controlled model results and simulated HTTP responses. They do not verify production XTEST credentials, database privileges, real model output or the appearance of a running Gateway page.

<a id="model-experience"></a>
## Model Experience

The `requirements` tool exposes the same requirement operations as the workbench. The `case_design` tool is available only in the case-design preset and advances one run by one pipeline node; it does not accept arbitrary run IDs. Each pipeline node runs under its `case-role-<role>` preset and receives the snapshot, upstream output and gate rule as task data; the preset exposes only `structured_output` plus, for actor roles, the single `skill` tool that loads their bound role procedure, judge roles hold no skill, and the role guard rejects every other tool call. The dedicated `cpic-case-design-worker` preset covers four-stage runs with structured output only. Workers do not inherit the parent’s orchestration instructions. Cost increases with requirement length and revision count. Requirement text and model output follow existing Session logging rules; the Host sends QA records to XTEST, which stores tenant-scoped `cpic_qa_*` records.

<a id="known-limitations"></a>
## Known limitations

This workbench supports an individual owner; it does not provide tenant-member management or shared authorization. Gateway tenant identity comes from the server-side tenant registry. Operators must verify database connectivity, account permissions and existing QA table schema. Manual execution is not automated execution, and users remain responsible for evidence files.
