# Workflow runtime compatibility

English | [中文](README.zh.md)

This local patch lets community Workflow 0.1.2 use the current Harness managed subagent API. It queries only allowed tools when building a read-only policy and preserves startup errors in the run store. Runs with failed children finish as failed even when their scripts catch the error or return a failure object.

Apply the patch to the installed plugin directory:

```powershell
node extensions/workflow-runtime-compat/apply.mjs 'D:\DSH\runtime\tenants\admin\home\profiles\web\node_modules\@dsh-external\workflow'
```

The patch checks the package version and all replacement locations before writing. It preserves each original module beside it with the suffix `.pre-activation-compat`. Reapplying the same patch makes no further module changes. Reinstalling or updating the community plugin can replace these files; inspect a different plugin version before adapting the patch.

Restart the owning tenant backend to load the changed modules. Refreshing a browser does not reload server modules. New run snapshots include the initiating session ID and versioned `process.graph` data. The graph records workflow containment, phase membership, and task-to-task evidence references declared by `task_id:` inputs; evidence references do not gate task scheduling, and the graph does not infer execution dependencies from order or timestamps. Existing run records remain unchanged and are not linked by timestamp or title.

Run the isolated regressions using an installation whose dependencies resolve under plain Node:

```powershell
node extensions/workflow-runtime-compat/test.mjs 'C:\Users\admin\.dsh\profiles\web\node_modules\@dsh-external\workflow'
```

The tests copy the installed modules into a private temporary directory and remove that directory after settlement. They exercise the restricted script runtime, simultaneous child admission, task evidence-reference graph projection, cancellation, and persisted failure reporting with controlled child executions. They do not verify a live model provider or browser rendering.
