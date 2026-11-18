/** Durable, payload-free execution history stored with analysis checkpoints. */
import { z } from 'zod'
import { STAGES } from './engine.js'

export const executionEventSchema = z.object({
  seq: z.number().int().nonnegative(), time: z.number().int().nonnegative().optional(), type: z.string().min(1),
  data: z.object({
    name: z.string().optional(), stage: z.enum(STAGES).optional(), attempt: z.number().int().positive().optional(),
    try: z.number().int().positive().optional(), taskId: z.string().optional(), role: z.enum(['generation', 'review']).optional(),
    outcome: z.string().optional(), code: z.string().optional(),
  }).strict(),
}).strict()

/** Create the run's first timestamped event from its durable creation time. */
export function initialExecutionEvents(name, createdAt) {
  const timestamp = Date.parse(createdAt)
  return [executionEventSchema.parse({
    seq: 0, ...(Number.isFinite(timestamp) ? { time: timestamp } : {}), type: 'run-started', data: { name },
  })]
}

/** Append timestamped metadata in commit order; payloads exclude prompts and model output. */
export function withExecutionEvents(record, entries, time = Date.now()) {
  const events = record.events ?? []
  return {
    ...record,
    events: [...events, ...entries.map((entry, index) => executionEventSchema.parse({
      seq: events.length + index, time, ...entry,
    }))],
  }
}

const eventKey = event => `${event.type}:${event.data.stage ?? event.data.name ?? ''}:${event.data.attempt ?? ''}`

/** Fill unrecorded history on pre-timeline runs without assigning unknown event times. */
export function completeLegacyExecutionEvents(record, name) {
  const existing = record.events ?? []
  if (existing.some(event => event.type === 'run-started')) return existing
  const prior = new Set(existing.map(eventKey))
  const entries = []
  const add = (type, data, time) => {
    const event = executionEventSchema.parse({ seq: 0, ...(time === undefined ? {} : { time }), type, data })
    if (!prior.has(eventKey(event))) entries.push(event)
  }
  const startedAt = Date.parse(record.createdAt)
  add('run-started', { name }, Number.isFinite(startedAt) ? startedAt : undefined)
  for (const stage of STAGES) {
    const entry = record.engine?.stages?.[stage]
    for (const attempt of entry?.attempts ?? []) {
      add('phase-started', { name: `${stage} attempt ${attempt.attempt}`, stage, attempt: attempt.attempt, role: 'generation', try: attempt.attempt })
      add('phase-candidate-saved', { name: stage, stage, attempt: attempt.attempt })
      if (attempt.review) add('phase-reviewed', { name: stage, stage, attempt: attempt.attempt, outcome: attempt.review.passed ? 'passed' : 'needs revision' })
    }
    if (entry?.status === 'committed') add('phase-completed', { name: stage, stage })
  }
  const status = record.engine?.status
  if (['completed', 'completed_with_issues'].includes(status)) add('run-completed', { outcome: status })
  else if (status === 'cancelled') add('run-cancelled', { outcome: status })
  else if (status === 'result_unverified' || record.problem) add('run-interrupted', { outcome: record.engine?.problem ?? record.problem })
  const offset = entries.length
  return [...entries.map((event, index) => ({ ...event, seq: index })), ...existing.map((event, index) => ({ ...event, seq: offset + index }))]
}

/** Derive stage-history events only for transitions accepted by the analysis engine. */
export function engineExecutionEvents(previous, next) {
  if (!previous) return []
  const events = []
  for (const stage of STAGES) {
    const before = previous.stages[stage]
    const after = next.stages[stage]
    if (after.attempts.length > before.attempts.length) {
      events.push({ type: 'phase-candidate-saved', data: { name: stage, stage, attempt: after.attempts.at(-1).attempt } })
    }
    const reviewed = after.attempts.at(-1)
    if (reviewed?.review && !before.attempts.find(attempt => attempt.attempt === reviewed.attempt)?.review) {
      events.push({ type: 'phase-reviewed', data: { name: stage, stage, attempt: reviewed.attempt, outcome: reviewed.review.passed ? 'passed' : 'needs revision' } })
    }
    for (const gate of reviewed?.checks ?? []) {
      const priorAttempt = before.attempts.find(attempt => attempt.attempt === reviewed.attempt)
      if (!priorAttempt?.checks?.some(existing => existing.node === gate.node)) {
        events.push({ type: 'phase-reviewed', data: { name: gate.node, stage, attempt: reviewed.attempt, outcome: gate.passed ? 'passed' : 'needs revision' } })
      }
    }
    if (after.status === 'committed' && before.status !== 'committed') events.push({ type: 'phase-completed', data: { name: stage, stage } })
  }
  if (previous.status !== next.status) {
    const type = next.status === 'cancelled' ? 'run-cancelled'
      : ['completed', 'completed_with_issues'].includes(next.status) ? 'run-completed'
        : previous.status === 'cancelled' && next.status === 'running' ? 'run-resumed' : 'run-interrupted'
    events.push({ type, data: { outcome: next.status } })
  }
  return events
}
