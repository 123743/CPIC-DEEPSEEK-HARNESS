/** Bounded case-design tasks retain original citations and validate coverage before aggregation. */
import { validateStage } from './engine.js'
import { WorkbenchError } from './business.js'

const keys = { cleanup: 'requirements', features: 'features', outline: 'scenarios', testcases: 'testcases' }
const parent = { features: ['cleanup', 'requirementIds'], outline: ['features', 'featureIds'], testcases: ['outline', 'scenarioIds'] }
const bytes = value => Buffer.byteLength(value)

function ancestors(stage, items, upstream) {
  if (stage === 'cleanup') return {}
  const [prior, field] = parent[stage]
  const ids = new Set(items.flatMap(item => item[field]))
  const selected = upstream[prior][keys[prior]].filter(item => ids.has(item.id))
  return { ...ancestors(prior, selected, upstream), [prior]: { ...upstream[prior], [keys[prior]]: selected } }
}

function sourceText(lines, refs) {
  const selected = new Set()
  for (const ref of refs) for (let line = ref.startLine; line <= ref.endLine; line++) selected.add(line)
  return [...selected].sort((left, right) => left - right).map(line => `${line}: ${lines[line - 1]}`).join('\n')
}

function splitUnits(units, limit, measure) {
  const groups = []
  let group = []
  for (const unit of units) {
    if (group.length && measure([...group, unit]) > limit) { groups.push(group); group = [] }
    group.push(unit)
  }
  if (group.length) groups.push(group)
  return groups
}

/**
 * Generate or inspect bounded portions of one stage. Partial results remain local until every
 * portion succeeds; only the caller commits the aggregate. Output-limit retries halve a portion,
 * never reuse a truncated structured payload, and stop at a single indivisible source item.
 * @param {object} input Fixed Markdown, committed upstream, stage, byte budgets, signal and optional candidate.
 * @param {Function} task Runs one standalone generation or verdict using the supplied task data.
 * @returns {Promise<object>} Validated aggregate stage output or combined verdict.
 */
export async function runBatches({ markdown, upstream, stage, maxTaskInputBytes, maxBatchItems, maxOutputBytes, signal, candidate, supplemental = '', maxAttempts = 1 }, task) {
  const lines = markdown.split(/\r\n|\n|\r/)
  if (lines.at(-1) === '') lines.pop()
  const inspection = candidate !== undefined
  let units
  if (inspection) units = candidate[keys[stage]]
  else if (stage === 'cleanup') {
    units = []
    let start = 0
    let fenced = false
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
      if (!fenced && index > start && (/^#{1,6}\s/.test(line) || !line.trim())) {
        units.push({ sourceRefs: [{ startLine: start + 1, endLine: index }] })
        start = index
      }
    }
    units.push({ sourceRefs: [{ startLine: start + 1, endLine: lines.length }] })
    units = units.filter(unit => lines.slice(unit.sourceRefs[0].startLine - 1, unit.sourceRefs[0].endLine).some(line => line.trim()))
    // A paragraph or table larger than the budget can still be divided at original line boundaries.
    units = units.flatMap(unit => {
      if (bytes(sourceText(lines, unit.sourceRefs)) <= maxTaskInputBytes) return [unit]
      const ref = unit.sourceRefs[0]
      return Array.from({ length: ref.endLine - ref.startLine + 1 }, (_, index) => ({ sourceRefs: [{ startLine: ref.startLine + index, endLine: ref.startLine + index }] }))
    })
  }
  else { const [prior] = parent[stage]; units = upstream[prior][keys[prior]] }
  const dataFor = group => {
    let selected
    if (inspection) selected = ancestors(stage, group, upstream)
    else if (stage === 'cleanup') selected = {}
    else { const [prior] = parent[stage]; selected = { ...ancestors(prior, group, upstream), [prior]: { ...upstream[prior], [keys[prior]]: group } } }
    const refs = [...group.flatMap(item => item.sourceRefs), ...Object.entries(selected).flatMap(([prior, value]) => value[keys[prior]].flatMap(item => item.sourceRefs))]
    const numbered = sourceText(lines, refs) + (supplemental ? `\nSupplemental answers (original source numbering remains unchanged):\n${supplemental}` : '')
    return { numbered, upstream: selected, ...(inspection ? { candidate: { ...candidate, [keys[stage]]: group } } : {}) }
  }
  const measure = group => bytes(JSON.stringify(dataFor(group)))
  const groups = splitUnits(units, maxTaskInputBytes, measure).flatMap(group => {
    if (stage === 'cleanup' && !inspection) return [group]
    return Array.from({ length: Math.ceil(group.length / maxBatchItems) }, (_, index) => group.slice(index * maxBatchItems, (index + 1) * maxBatchItems))
  })
  const results = []
  let outputBytes = 0
  async function execute(group, attempt = 1, feedback = '') {
    signal.throwIfAborted()
    const data = dataFor(group)
    try {
      if (measure(group) > maxTaskInputBytes) throw new WorkbenchError('TASK_INPUT_LIMIT', 'A case-design task exceeds maxTaskInputBytes; split the cited source item or increase the configured budget.')
      const output = await task({ ...data, feedback })
      signal.throwIfAborted()
      if (inspection) {
        if (typeof output?.passed !== 'boolean' || !Array.isArray(output.issues) || output.issues.some(issue => typeof issue !== 'string' || !issue.trim())) throw new WorkbenchError('MODEL_OUTPUT', 'The batch review did not return a valid verdict.')
      } else {
        validateStage(stage, output, data.upstream, markdown)
        const supplied = new Set(data.numbered.split('\n').map(line => /^(\d+):/.exec(line)).filter(Boolean).map(match => Number(match[1])))
        for (const item of output[keys[stage]]) for (const ref of item.sourceRefs) {
          for (let line = ref.startLine; line <= ref.endLine; line++) if (!supplied.has(line)) throw new WorkbenchError('BATCH_SOURCE', 'A batch output cites source lines outside its supplied portion.')
        }
      }
      outputBytes += bytes(JSON.stringify(output))
      if (outputBytes > maxOutputBytes) throw new WorkbenchError('OUTPUT_TOO_LARGE', 'Combined stage output exceeds maxOutputBytes; increase the stage artifact budget or split the analysis.')
      results.push(output)
    } catch (error) {
      if ((error.name === 'EngineError' || error.code === 'BATCH_SOURCE') && attempt < maxAttempts) return execute(group, attempt + 1, error.message)
      if (!['MODEL_OUTPUT_LIMIT', 'TASK_INPUT_LIMIT'].includes(error.code)) throw error
      if (group.length === 1 && stage === 'cleanup' && !inspection) {
        const ref = group[0].sourceRefs[0]
        if (ref.startLine < ref.endLine) {
          const middleLine = Math.floor((ref.startLine + ref.endLine) / 2)
          await execute([{ sourceRefs: [{ startLine: ref.startLine, endLine: middleLine }] }])
          await execute([{ sourceRefs: [{ startLine: middleLine + 1, endLine: ref.endLine }] }])
          return
        }
      }
      if (group.length < 2) throw error
      const middle = Math.ceil(group.length / 2)
      await execute(group.slice(0, middle))
      await execute(group.slice(middle))
    }
  }
  for (const group of groups) await execute(group)
  if (inspection) return { passed: results.every(result => result.passed), issues: [...new Set(results.flatMap(result => result.issues))] }
  const output = { [keys[stage]]: results.flatMap((result, index) => result[keys[stage]].map(item => ({ ...item, id: results.length > 1 ? `${stage}-b${index + 1}-${item.id}` : item.id }))), ...(stage === 'cleanup' ? { questions: [...new Set(results.flatMap(result => result.questions))] } : {}) }
  if (bytes(JSON.stringify(output)) > maxOutputBytes) throw new WorkbenchError('OUTPUT_TOO_LARGE', 'Combined stage output exceeds maxOutputBytes; increase the stage artifact budget or split the analysis.')
  return validateStage(stage, output, upstream, markdown)
}
