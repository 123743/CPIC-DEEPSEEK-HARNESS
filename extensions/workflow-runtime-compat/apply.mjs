import { readFile, writeFile, copyFile } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** Patch only the inspected community Workflow 0.1.2 build; preserve each original once. */
export async function applyCompatibility(root) {
  const packageInfo = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  if (packageInfo.name !== '@dsh-external/workflow' || packageInfo.version !== '0.1.2') {
    throw new Error('Compatibility patch requires @dsh-external/workflow 0.1.2')
  }
  const changes = [
    ['index.js', [
      ["import { createWorkflowSubagents } from './activation.js';\n", null],
      ['subagents: ctx.subagents,', 'subagents: createWorkflowSubagents(ctx),'],
    ]],
    ['engine.js', [
      ["            execution: input.module.execution,\n            startedAt,", "            execution: input.module.execution,\n            sessionId: String(input.parent.session.id),\n            startedAt,"],
      ["    const schemas = parent.ctx?.tools?.schemas(parent) ?? [];\n    const visible = new Set(schemas.map(schema => schema.name).filter(name => name !== 'run_code'));\n    const deny = new Set(denied);\n    return { allow: [...new Set(configured)].filter(name => visible.has(name) && !deny.has(name)) };", "    const tools = parent.ctx?.tools;\n    const deny = new Set(denied);\n    return { allow: [...new Set(configured)].filter(name => name !== 'run_code' && !deny.has(name) && tools?.get(name, parent) !== undefined) };"],
      ["            runAgent: async (input) => {\n                try {\n                    const handle = await start(input);\n                    const result = await this.waitTask(run, handle.taskId);\n                    return result.status === 'failed' || result.status === 'stopped' ? null : result;\n                }\n                catch (error) {\n                    if (isControlError(error))\n                        throw error;\n                    return null;", "            runAgent: async (input) => {\n                try {\n                    const handle = await start(input);\n                    const result = await this.waitTask(run, handle.taskId);\n                    return result.status === 'failed' || result.status === 'stopped' ? null : result;\n                }\n                catch (error) {\n                    run.snapshot = { ...run.snapshot, error: message(error) };\n                    this.emit(run, 'agent-start-failed', { name: input.name, error: message(error) });\n                    if (isControlError(error))\n                        throw error;\n                    throw new WorkflowControlError(`workflow child \"${input.name}\" could not start: ${message(error)}`, { cause: error });"],
      ["            await Promise.allSettled([...run.tasks.values()].map(task => task.promise));\n            if (run.controller.signal.aborted", "            await Promise.allSettled([...run.tasks.values()].map(task => task.promise));\n            const failedTasks = [...run.tasks.values()].filter(task => task.status === 'failed' || task.status === 'stopped');\n            if (!run.controller.signal.aborted && run.snapshot.status !== 'stopped' && (run.snapshot.error !== undefined || failedTasks.length > 0)) {\n                throw new WorkflowControlError(run.snapshot.error ?? failedTasks.map(task => `${task.input.name}: ${task.result?.stopReason ?? task.status}`).join('; '));\n            }\n            if (run.controller.signal.aborted"],
    ]],
  ]
  const outputs = []
  for (const [name, replacements] of changes) {
    const path = join(root, 'lib', name)
    const original = await readFile(path, 'utf8')
    let text = original.replace(/\r\n/gu, '\n')
    for (const [before, after] of replacements) {
      if (after === null) {
        if (!text.includes(before)) text = before + text
      } else if (text.includes(before)) {
        if (text.indexOf(before) !== text.lastIndexOf(before)) throw new Error(`Ambiguous patch in ${name}`)
        text = text.replace(before, after)
      } else if (!text.includes(after)) {
        throw new Error(`Unrecognized ${name}; no files have been changed`)
      }
    }
    if (name === 'engine.js') {
      const itemAnchor = '        const items = [...phaseItems, ...agentItems, ...stepItems, ...artifactItems];'
      const graphLines = [
        itemAnchor,
        '        const rootId = `workflow:${run.snapshot.runId}`;',
        '        const graph = {',
        '            version: 1,',
        '            nodes: [{ id: rootId, title: run.snapshot.displayName ?? run.snapshot.workflow, kind: \'workflow\', status: run.snapshot.status === \'stopped\' || run.snapshot.status === \'denied\' ? \'cancelled\' : run.snapshot.status, startedAt: new Date(run.snapshot.startedAt).toISOString() }, ...items],',
        '            edges: [',
        '                ...items.filter(item => item.kind !== \'agent\' || item.phaseId === undefined)',
        '                    .map(item => ({ id: `contains:${rootId}:${item.id}`, source: rootId, target: item.id, type: \'contains\' })),',
        '                ...agentItems.filter(item => item.phaseId !== undefined)',
        '                    .map(item => ({ id: `phase:${item.phaseId}:${item.id}`, source: item.phaseId, target: item.id, type: \'phase-membership\' })),',
        '                ...[...run.tasks.values()].flatMap(task => (task.input.evidenceRefs ?? [])',
        '                    .filter(ref => ref.startsWith(\'task_id:\'))',
        '                    .map(ref => ({ source: ref.slice(\'task_id:\'.length).trim(), target: task.id }))',
        '                    .filter(edge => run.tasks.has(edge.source))',
        '                    .map(edge => ({ id: `evidence-reference:${edge.source}:${edge.target}`, ...edge, type: \'evidence-reference\' }))),',
        '            ],',
        '        };',
      ].join('\n')
      if (text.includes(itemAnchor) && !text.includes('const graph = {')) text = text.replace(itemAnchor, graphLines)
      else if (!text.includes('const graph = {')) throw new Error('Unrecognized engine.js process projection; no files have been changed')
      const snapshotAnchor = 'updatedAt: new Date(this.now()).toISOString(), items, counts,'
      if (text.includes(snapshotAnchor)) text = text.replace(snapshotAnchor, 'updatedAt: new Date(this.now()).toISOString(), items, graph, counts,')
      else if (!text.includes('updatedAt: new Date(this.now()).toISOString(), items, graph, counts,')) throw new Error('Unrecognized engine.js process snapshot; no files have been changed')
      text = text.replace("type: 'depends-on'", "type: 'evidence-reference'").replace('id: `dependency:', 'id: `evidence-reference:')
    }
    outputs.push({ path, original, text })
  }
  const adapter = await readFile(join(here, 'activation.js'), 'utf8')
  // Validate all replacement anchors before writing any installed module.
  for (const { path, original, text } of outputs) {
    if (text === original) continue
    try { await writeFile(`${path}.pre-activation-compat`, original, { flag: 'wx' }) }
    catch (error) { if (error.code !== 'EEXIST') throw error }
  }
  await copyFile(join(here, 'activation.js'), join(root, 'lib', 'activation.js'))
  for (const { path, original, text } of outputs) {
    if (text !== original) await writeFile(path, text)
  }
  return { root: resolve(root), adapterBytes: Buffer.byteLength(adapter), patched: outputs.filter(item => item.text !== item.original).map(item => item.path) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Pass the installed @dsh-external/workflow directory')
  console.log(JSON.stringify(await applyCompatibility(resolve(process.argv[2])), null, 2))
}
