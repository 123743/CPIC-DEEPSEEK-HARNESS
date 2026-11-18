/** Validated pipeline definition for the serial case-design nodes. */
import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { STAGES } from './engine.js'

/** Version stamped on new runs and on the pipeline template itself. */
export const PIPELINE_SCHEMA_VERSION = 2

const slug = z.string().min(1).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u, 'must be a kebab-case identifier')
const actorRef = z.object({ role: slug, skill: slug, workspace: slug }).strict()
const judgeRef = z.object({ role: slug, rule: z.string().min(30) }).strict()
const nodeSchema = z.object({
  id: slug,
  stage: z.enum(STAGES),
  kind: z.enum(['generate', 'review']),
  actor: actorRef,
  judge: judgeRef,
}).strict()
const pipelineSchema = z.object({
  version: z.literal(PIPELINE_SCHEMA_VERSION),
  name: slug,
  mode: z.literal('serial'),
  nodes: z.array(nodeSchema).min(1),
}).strict()

/** Expected failure while loading or updating a pipeline definition. */
export class PipelineError extends Error {
  /**
   * @param {string} code Machine-readable failure category.
   * @param {string} message Actionable diagnostic.
   * @param {object} details Validation location or affected node.
   */
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'PipelineError'
    this.code = code
    this.details = details
  }
}

function fail(code, message, details) { throw new PipelineError(code, message, details) }
function unique(values, code, label) {
  const seen = new Set()
  for (const value of values) {
    if (seen.has(value)) fail(code, `Duplicate ${label} ${value}; every node needs its own ${label}.`, { value })
    seen.add(value)
  }
}

/**
 * Parse and semantically validate a pipeline definition without mutating it.
 * The serial chain is explicit: stages appear in STAGES order, every stage has
 * one generate node before any of its review nodes, and every actor and judge
 * role, skill, and workspace belongs to exactly one node.
 * @param {unknown} value Candidate definition.
 * @returns {object} Validated detached definition.
 */
export function validatePipeline(value) {
  const parsed = pipelineSchema.parse(value)
  unique(parsed.nodes.map((node) => node.id), 'DUPLICATE_NODE', 'node id')
  unique(parsed.nodes.map((node) => node.actor.role), 'DUPLICATE_ROLE', 'actor role')
  unique(parsed.nodes.map((node) => node.judge.role), 'DUPLICATE_ROLE', 'judge role')
  unique(parsed.nodes.map((node) => node.actor.skill), 'DUPLICATE_SKILL', 'skill')
  unique(parsed.nodes.map((node) => node.actor.workspace), 'DUPLICATE_WORKSPACE', 'workspace')
  for (const node of parsed.nodes) {
    if (node.actor.role === node.judge.role) fail('ROLE_CONFLICT', `Node ${node.id} must not review itself; give the judge its own role.`, { node: node.id })
  }
  const generates = new Map()
  parsed.nodes.forEach((node, index) => {
    if (node.kind === 'generate') {
      if (generates.has(node.stage)) fail('DUPLICATE_GENERATE', `Stage ${node.stage} has more than one generate node.`, { stage: node.stage })
      generates.set(node.stage, index)
    }
  })
  for (const stage of STAGES) if (!generates.has(stage)) fail('MISSING_STAGE', `Stage ${stage} has no generate node.`, { stage })
  for (const node of parsed.nodes) {
    if (node.kind === 'review' && generates.get(node.stage) > parsed.nodes.indexOf(node)) {
      fail('REVIEW_ORDER', `Review node ${node.id} must follow the generate node of stage ${node.stage}.`, { node: node.id })
    }
  }
  const order = parsed.nodes.map((node) => STAGES.indexOf(node.stage))
  if (order.some((stage, index) => index > 0 && stage < order[index - 1])) {
    fail('STAGE_ORDER', 'Pipeline nodes must run stages in STAGES order; the chain is serial.', { stages: order })
  }
  return structuredClone(parsed)
}

/**
 * Read a pipeline YAML file and validate it. Load failures are fatal at startup.
 * @param {string | URL} fileURL Pipeline YAML location.
 * @returns {object} Validated detached definition.
 */
export function loadPipeline(fileURL) {
  let text
  try { text = readFileSync(fileURL, 'utf8') } catch (cause) { throw new PipelineError('PIPELINE_MISSING', `Pipeline definition is unreadable at ${String(fileURL)}`, {}, cause) }
  try { return validatePipeline(parseYaml(text)) } catch (cause) {
    if (cause instanceof PipelineError) throw cause
    throw new PipelineError('PIPELINE_INVALID', `Pipeline definition at ${String(fileURL)} is invalid: ${cause.message}`, {}, cause)
  }
}

/**
 * Ordered gate node ids per stage; a stage commits only when every gate passes.
 * @param {object} pipeline Validated definition.
 * @returns {object} Stage id to ordered node ids.
 */
export function gatesOf(pipeline) {
  return Object.fromEntries(STAGES.map((stage) => [stage, pipeline.nodes.filter((node) => node.stage === stage).map((node) => node.id)]))
}

/**
 * The node that a later advance executes, or undefined when the chain is complete or blocked.
 * @param {object} run Stored run state carrying a pipeline definition.
 * @returns {object | undefined} Pipeline node.
 */
export function nextNodeOf(run) {
  const gates = gatesOf(run.pipeline)
  for (const node of run.pipeline.nodes) {
    const entry = run.stages[node.stage]
    if (entry.status === 'committed') continue
    if (entry.status === 'awaiting_check') {
      const latest = entry.attempts.at(-1)
      if (gates[node.stage][latest.checks.length] === node.id) return node
      continue
    }
    if (entry.status === 'blocked') return undefined
    if (node.kind === 'generate') return node
  }
  return undefined
}

/**
 * The node whose failed check blocked its stage, if any.
 * @param {object} run Stored run state carrying a pipeline definition.
 * @returns {object | undefined} Pipeline node.
 */
export function blockedNodeOf(run) {
  for (const node of run.pipeline.nodes) {
    const entry = run.stages[node.stage]
    if (entry.status !== 'blocked') continue
    const latest = entry.attempts.at(-1)
    if (latest?.checks.at(-1)?.node === node.id) return node
  }
  return undefined
}

/**
 * Per-node execution state derived from one stored run. Generate nodes report
 * the stage value as output; review nodes report their accepted verdict.
 * @param {object} run Stored run state carrying a pipeline definition.
 * @returns {object[]} Node states in pipeline order.
 */
export function nodeStates(run) {
  const gates = gatesOf(run.pipeline)
  const current = nextNodeOf(run)
  const blocked = blockedNodeOf(run)
  return run.pipeline.nodes.map((node) => {
    const entry = run.stages[node.stage]
    const latest = entry.attempts.at(-1)
    const checks = entry.attempts.flatMap((attempt) => attempt.checks
      .filter((check) => check.node === node.id)
      .map((check) => ({ ...structuredClone(check), attempt: attempt.attempt })))
    const accepted = checks.find((check) => check.passed)
    const status = entry.status === 'committed' ? 'completed'
      : run.status === 'result_unverified' ? 'uncertain'
        : entry.status === 'blocked' ? (blocked?.id === node.id ? 'blocked' : 'pending')
          : entry.status === 'awaiting_check' && accepted ? 'completed'
            : current?.id === node.id ? 'running' : 'pending'
    const output = node.kind === 'generate' ? (entry.committed ?? latest?.value ?? null)
      : checks.at(-1) ? { passed: checks.at(-1).passed, issues: checks.at(-1).issues } : null
    return {
      id: node.id, stage: node.stage, kind: node.kind,
      actor: structuredClone(node.actor), judge: structuredClone(node.judge),
      status, attempts: entry.attempts.length, checks,
      blockedReason: status === 'blocked' ? (latest?.checks.filter((check) => check.node === node.id).at(-1)?.issues.join(' ') || 'The judge did not accept this node.') : null,
      output,
      gates: gates[node.stage],
    }
  })
}
