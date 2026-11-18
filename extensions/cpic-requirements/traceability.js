import { STAGES, validateStage } from './engine.js'
import { digest, WorkbenchError } from './business.js'

const LEVELS = Object.freeze([
  { key: 'cleanup', name: 'stageCleanup', items: 'requirements', link: null },
  { key: 'features', name: 'stageFeatures', items: 'features', link: 'requirementIds' },
  { key: 'outline', name: 'stageOutline', items: 'scenarios', link: 'featureIds' },
  { key: 'testcases', name: 'stageTestcases', items: 'testcases', link: 'scenarioIds' },
])

/** Analyze the committed stage prefix in both directions without changing the run. */
export async function analyzeTraceability({ record, files }) {
  if (!record?.engine) throw new WorkbenchError('RUN_NOT_READY', 'This case-design run has no analysis state yet')
  const snapshot = await files.read(record.snapshot.path)
  if (digest(snapshot) !== record.snapshot.hash) throw new WorkbenchError('SNAPSHOT_CHANGED', 'The saved requirement snapshot has changed')
  const stages = record.engine.stages ?? {}
  const outputs = []
  const validatedStages = {}
  const incompleteStages = []
  for (const stage of STAGES) {
    const committed = stages[stage]?.committed
    if (committed === null || committed === undefined) {
      incompleteStages.push(...STAGES.slice(STAGES.indexOf(stage)).map(stageId => LEVELS[STAGES.indexOf(stageId)].name))
      break
    }
    const validated = validateStage(stage, committed, validatedStages, snapshot)
    validatedStages[stage] = validated
    outputs.push(validated)
  }
  const checks = []
  for (let index = 0; index < outputs.length - 1; index += 1) {
    const source = outputs[index][LEVELS[index].items]
    const destination = outputs[index + 1][LEVELS[index + 1].items]
    const refs = new Set(destination.flatMap(item => item[LEVELS[index + 1].link] ?? []))
    const missing = source.filter(item => !refs.has(item.id)).map(item => ({ id: item.id, title: item.title ?? item.text }))
    checks.push({ direction: 'forward', from: LEVELS[index].name, to: LEVELS[index + 1].name, totalCount: source.length, issueCount: missing.length, issues: missing })
  }
  for (let index = outputs.length - 1; index > 0; index -= 1) {
    const destination = outputs[index][LEVELS[index].items]
    const sourceIds = new Set(outputs[index - 1][LEVELS[index - 1].items].map(item => item.id))
    const missing = destination.flatMap(item => (item[LEVELS[index].link] ?? [])
      .filter(id => !sourceIds.has(id)).map(id => ({ id, title: item.title })))
    checks.push({ direction: 'reverse', from: LEVELS[index].name, to: LEVELS[index - 1].name, totalCount: destination.length, issueCount: missing.length, issues: missing })
  }
  const finalOutput = outputs.at(-1)
  const sourceRefs = finalOutput?.testcases?.flatMap(item => item.sourceRefs) ?? []
  const counts = Object.fromEntries(LEVELS.map((level, index) => [level.items, outputs[index]?.[level.items]?.length ?? 0]))
  const graphNodes = []
  const stageNodeIds = []
  for (const [index, output] of outputs.entries()) {
    const level = LEVELS[index]
    const ids = output[level.items].map(item => `${level.key}:${item.id}`)
    stageNodeIds.push(ids)
    graphNodes.push(...output[level.items].map(item => ({
      id: `${level.key}:${item.id}`, title: `${item.id} · ${item.title ?? item.text}`,
      kind: 'artifact', status: 'completed', stage: level.name,
    })))
  }
  const graphEdges = outputs.slice(1).flatMap((output, index) => {
    const sourceLevel = LEVELS[index]
    const targetLevel = LEVELS[index + 1]
    const sourceIds = new Set(stageNodeIds[index])
    return output[targetLevel.items].flatMap(item => (item[targetLevel.link] ?? [])
      .filter(id => sourceIds.has(`${sourceLevel.key}:${id}`))
      .map(id => ({
        id: `reference:${sourceLevel.key}:${id}->${targetLevel.key}:${item.id}`,
        source: `${sourceLevel.key}:${id}`,
        target: `${targetLevel.key}:${item.id}`,
        type: 'evidence-reference',
      })))
  })
  const hasIssues = checks.some(check => check.issueCount > 0)
  const status = hasIssues ? 'ISSUES' : incompleteStages.length > 0 ? 'PARTIAL' : 'PASS'
  return {
    runId: record.id, status, checks, incompleteStages,
    counts, sourceReferenceCount: sourceRefs.length,
    graph: graphNodes.length ? { version: 1, nodes: graphNodes, edges: graphEdges } : null,
  }
}
