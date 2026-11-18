/** Standalone case-design validation and execution; storage and reviewer authorization belong to callers. */
import { isDeepStrictEqual } from 'node:util';

/** Ordered stages; only committed outputs are available to the next stage. */
export const STAGES = Object.freeze(['cleanup', 'features', 'outline', 'testcases']);

const string = { type: 'string', minLength: 1 };
const strings = { type: 'array', items: string };
const ids = { ...strings, minItems: 1, uniqueItems: true };
const object = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const list = (items) => ({ type: 'array', items, minItems: 1 });
const refs = list(object({ startLine: { type: 'integer', minimum: 1 }, endLine: { type: 'integer', minimum: 1 } }));
const sourced = { id: string, sourceRefs: refs };
const step = object({ action: string, expected: string });
const schemas = {
  cleanup: object({ requirements: list(object({ ...sourced, text: string })), questions: strings }),
  features: object({ features: list(object({ ...sourced, title: string, requirementIds: ids, businessRules: strings })) }),
  outline: object({ scenarios: list(object({ ...sourced, title: string, featureIds: ids })) }),
  testcases: object({ testcases: list(object({
    ...sourced, title: string, featureIds: ids, scenarioIds: ids,
    priority: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] }, type: string,
    preconditions: strings, testData: string, steps: list(step),
  })) }),
};

function freeze(value) {
  Object.freeze(value);
  for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child);
  return value;
}

/** JSON Schemas for model prompts; validateStage also checks references, IDs, and coverage. */
export const STAGE_SCHEMAS = freeze(schemas);

/** Separate review payload; the caller must authenticate and authorize its reviewer. */
export const REVIEW_SCHEMA = freeze(object({
  stage: { type: 'string', enum: STAGES.slice(1) },
  attempt: { type: 'integer', minimum: 1 }, passed: { type: 'boolean' }, issues: strings,
}));

/** Judge gate payload for pipeline runs; the caller must authenticate and authorize its judge. */
export const CHECK_SCHEMA = freeze(object({
  stage: { type: 'string', enum: STAGES },
  node: string,
  attempt: { type: 'integer', minimum: 1 }, passed: { type: 'boolean' }, issues: strings,
  actorRole: string, judgeRole: string, skill: string,
}));

function gateNodes(run, stage) {
  return run.pipeline.nodes.filter((node) => node.stage === stage).map((node) => node.id);
}
function validatePipelineShape(pipeline) {
  check(record(pipeline) && pipeline.version === 2 && pipeline.mode === 'serial'
    && Array.isArray(pipeline.nodes) && pipeline.nodes.length > 0,
  'INVALID_CONFIG', 'Provide a version 2 serial pipeline definition.');
  const seen = new Set();
  for (const node of pipeline.nodes) {
    check(record(node) && typeof node.id === 'string' && node.id.length > 0 && STAGES.includes(node.stage)
      && (node.kind === 'generate' || node.kind === 'review') && record(node.actor) && record(node.judge),
    'INVALID_CONFIG', 'Pipeline nodes need id, stage, kind, actor and judge.', { node: record(node) ? node.id : undefined });
    check(!seen.has(node.id), 'INVALID_CONFIG', `Duplicate pipeline node ${node.id}.`, { node: node.id });
    seen.add(node.id);
  }
  for (const stage of STAGES) {
    const gates = pipeline.nodes.filter((node) => node.stage === stage);
    check(gates.some((node) => node.kind === 'generate'), 'INVALID_CONFIG', `Pipeline stage ${stage} has no generate node.`, { stage });
    check(gates[0].kind === 'generate', 'INVALID_CONFIG', `Pipeline stage ${stage} must generate before its reviews.`, { stage });
  }
}

/** Expected failure with a stable code, operation details, and optional underlying cause. */
export class EngineError extends Error {
  /**
   * @param {string} code Machine-readable failure category.
   * @param {string} message Actionable diagnostic.
   * @param {object} details Validation location or affected operation.
   * @param {unknown} cause Underlying adapter failure, when present.
   */
  constructor(code, message, details = {}, cause = undefined) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'EngineError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) { throw new EngineError(code, message, details); }
function check(condition, code, message, details) { if (!condition) fail(code, message, details); }
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function validate(schema, value, path = '$') {
  const type = schema.type;
  const valid = type === 'object' ? record(value) : type === 'array' ? Array.isArray(value)
    : type === 'integer' ? Number.isSafeInteger(value) : typeof value === type;
  check(valid, 'INVALID_SCHEMA', `${path} must be ${type}.`, { path });
  if (type === 'object') {
    for (const key of schema.required) check(Object.hasOwn(value, key), 'INVALID_SCHEMA', `${path}.${key} is required.`, { path: `${path}.${key}` });
    for (const key of Object.keys(value)) {
      check(Object.hasOwn(schema.properties, key), 'INVALID_SCHEMA', `${path}.${key} is not allowed.`, { path: `${path}.${key}` });
      validate(schema.properties[key], value[key], `${path}.${key}`);
    }
  } else if (type === 'array') {
    check(value.length >= (schema.minItems ?? 0), 'INVALID_SCHEMA', `${path} requires more items.`, { path });
    for (let index = 0; index < value.length; index += 1) {
      check(Object.hasOwn(value, index), 'INVALID_SCHEMA', `${path}[${index}] is missing.`, { path });
      validate(schema.items, value[index], `${path}[${index}]`);
    }
    if (schema.uniqueItems) check(new Set(value).size === value.length, 'DUPLICATE_LINK', `${path} has duplicate links.`, { path });
  } else if (type === 'string') {
    check(value.trim().length >= (schema.minLength ?? 0), 'INVALID_SCHEMA', `${path} must contain text.`, { path });
    if (schema.enum) check(schema.enum.includes(value), 'INVALID_SCHEMA', `${path} has an unsupported value.`, { path });
  } else if (type === 'integer') check(value >= schema.minimum, 'INVALID_SCHEMA', `${path} is below its minimum.`, { path });
}

const keys = { cleanup: 'requirements', features: 'features', outline: 'scenarios', testcases: 'testcases' };
function knownStage(stage) { check(STAGES.includes(stage), 'UNKNOWN_STAGE', 'Choose a stage from STAGES.', { stage }); }
function snapshotLines(markdown) {
  check(typeof markdown === 'string' && markdown.trim().length > 0, 'INVALID_SNAPSHOT', 'A nonempty immutable Markdown snapshot is required.');
  const lines = markdown.split(/\r\n|\n|\r/);
  if (lines.at(-1) === '') lines.pop();
  return lines.length;
}

/**
 * Validate untrusted stage JSON without mutation. Returns a detached JSON value or throws EngineError.
 * Upstream must contain validated, committed outputs for every preceding stage. Coverage requires
 * every requirement, feature, and scenario to be represented by the corresponding downstream links.
 * @param {string} stage Stage ID from STAGES.
 * @param {unknown} value Candidate JSON output; extra fields, including claimed review results, fail.
 * @param {object} upstream Committed outputs keyed by stage.
 * @param {string} snapshotMarkdown Immutable input used by one-based inclusive source references.
 * @returns {object} Validated detached output.
 */
export function validateStage(stage, value, upstream = {}, snapshotMarkdown) {
  knownStage(stage);
  const lineCount = snapshotLines(snapshotMarkdown);
  check(record(upstream), 'INVALID_UPSTREAM', 'Upstream outputs must be an object keyed by stage.');
  const index = STAGES.indexOf(stage);
  const allIds = new Set();
  const validated = {};
  for (const prior of STAGES.slice(0, index)) {
    check(Object.hasOwn(upstream, prior), 'MISSING_DEPENDENCY', `Commit ${prior} before submitting ${stage}.`, { stage, dependency: prior });
    validated[prior] = validateStage(prior, upstream[prior], validated, snapshotMarkdown);
    for (const item of validated[prior][keys[prior]]) allIds.add(item.id);
  }
  validate(STAGE_SCHEMAS[stage], value);
  for (const item of value[keys[stage]]) {
    check(!allIds.has(item.id), 'DUPLICATE_ID', `ID ${item.id} is already used.`, { stage, id: item.id });
    allIds.add(item.id);
    const seenRefs = new Set();
    for (const ref of item.sourceRefs) {
      check(ref.endLine >= ref.startLine && ref.endLine <= lineCount, 'INVALID_SOURCE', `Source reference for ${item.id} (${ref.startLine}-${ref.endLine}) is outside the snapshot with ${lineCount} lines.`, { stage, id: item.id, ...ref, lineCount });
      const key = `${ref.startLine}:${ref.endLine}`;
      check(!seenRefs.has(key), 'DUPLICATE_SOURCE', `Source reference for ${item.id} is duplicated.`, { stage, id: item.id, ...ref });
      seenRefs.add(key);
    }
  }
  const relations = stage === 'features' ? [['requirementIds', 'cleanup']]
    : stage === 'outline' ? [['featureIds', 'features']]
      : stage === 'testcases' ? [['featureIds', 'features'], ['scenarioIds', 'outline']] : [];
  for (const [field, prior] of relations) {
    const expected = new Set(validated[prior][keys[prior]].map((item) => item.id));
    const covered = new Set();
    for (const item of value[keys[stage]]) {
      for (const id of item[field]) {
        check(expected.has(id), 'UNKNOWN_LINK', `${item.id} links to unknown ${id}.`, { stage, id: item.id, field, target: id });
        covered.add(id);
      }
    }
    const missing = [...expected].filter((id) => !covered.has(id));
    check(missing.length === 0, 'INCOMPLETE_COVERAGE', `${stage} does not cover all ${prior} outputs.`, { stage, field, missing });
  }
  if (stage === 'testcases') {
    const scenarios = new Map(validated.outline.scenarios.map((item) => [item.id, item]));
    for (const item of value.testcases) {
      const linkedFeatures = new Set(item.scenarioIds.flatMap((id) => scenarios.get(id).featureIds));
      check(item.featureIds.every((id) => linkedFeatures.has(id)), 'INCONSISTENT_LINK', `${item.id} links to a feature outside its scenarios.`, { id: item.id });
      check([...linkedFeatures].every((id) => item.featureIds.includes(id)), 'INCONSISTENT_LINK', `${item.id} omits a feature from its linked scenarios.`, { id: item.id });
    }
  }
  return structuredClone(value);
}

function escapeMarkdown(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\\/g, '\\\\').replace(/([`*_{}\[\]()#+.!|~-])/g, '\\$1').replace(/\r\n|\r|\n/g, '<br>');
}

/**
 * Render schema-valid testcases as deterministic Markdown, escaping model-authored Markdown and HTML.
 * Cross-stage references must first be checked with validateStage.
 * @param {object} value Testcase output using STAGE_SCHEMAS.testcases.
 * @returns {string} Markdown document with one section per testcase and a trailing newline.
 */
export function renderTestcases(value) {
  validate(STAGE_SCHEMAS.testcases, value);
  const e = escapeMarkdown;
  const lines = ['# Test cases', ''];
  for (const item of value.testcases) {
    lines.push(`## ${e(item.id)}: ${e(item.title)}`, '',
      `- Priority: ${e(item.priority)}`, `- Type: ${e(item.type)}`,
      `- Features: ${item.featureIds.map(e).join(', ')}`, `- Scenarios: ${item.scenarioIds.map(e).join(', ')}`,
      `- Sources: ${item.sourceRefs.map((ref) => `L${ref.startLine}–L${ref.endLine}`).join(', ')}`, '',
      '### Preconditions', '', ...item.preconditions.map((text) => `- ${e(text)}`), '',
      '### Test data', '', e(item.testData), '', '### Steps', '', '| # | Action | Expected result |', '| --- | --- | --- |');
    item.steps.forEach((entry, index) => lines.push(`| ${index + 1} | ${e(entry.action)} | ${e(entry.expected)} |`));
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

/**
 * Create a detached initial run. maxAttempts includes the first valid candidate and all revisions.
 * A pipeline definition switches the run to gate semantics: every stage needs its pipeline node
 * checks, exhausted failed checks block instead of committing, and grantRevision reopens a blocked
 * stage. Without a pipeline the run keeps the legacy four-stage semantics of earlier releases.
 * @param {object} input Run ID, immutable snapshotMarkdown, required positive integer maxAttempts, and optional validated pipeline definition.
 * @returns {object} Initial running state; no storage effects occur.
 */
export function createRun({ id, snapshotMarkdown, maxAttempts, pipeline }) {
  check(typeof id === 'string' && id.trim().length > 0, 'INVALID_CONFIG', 'A nonempty run ID is required.');
  snapshotLines(snapshotMarkdown);
  check(Number.isSafeInteger(maxAttempts) && maxAttempts > 0, 'INVALID_CONFIG', 'maxAttempts must be a positive safe integer.');
  const base = { id, snapshotMarkdown, maxAttempts, revision: 0, status: 'running', artifacts: null };
  if (pipeline === undefined) {
    return { ...base, stages: Object.fromEntries(STAGES.map((stage) => [stage, { status: 'pending', attempts: [], committed: null }])) };
  }
  validatePipelineShape(pipeline);
  return {
    ...base,
    pipeline: structuredClone(pipeline),
    stages: Object.fromEntries(STAGES.map((stage) => [stage, { status: 'pending', attempts: [], committed: null, grants: 0, unblocks: [] }])),
  };
}

function upstreamOf(run, stage) {
  return Object.fromEntries(STAGES.slice(0, STAGES.indexOf(stage))
    .filter((prior) => run.stages[prior].status === 'committed')
    .map((prior) => [prior, run.stages[prior].committed]));
}
function active(run) { check(run.status === 'running', 'RUN_NOT_ACTIVE', `Run ${run.id} is ${run.status}.`, { runId: run.id, status: run.status }); }

/**
 * Apply submitStage, submitReview, submitCheck, grantRevision, cancel, resume, or markUncertain
 * without mutating the input run. Resume is valid only from cancelled and preserves the validated
 * stage checkpoint. Invalid submissions throw and consume no revision budget. Legacy runs commit
 * validated output with issues once negative reviews are exhausted; pipeline runs block instead
 * until grantRevision reopens the stage. A separate successful artifact readback is required for
 * completion.
 * @param {object} run State created by createRun or a previous transition.
 * @param {object} command Command with type and the associated stage, value, or review fields.
 * @returns {object} Detached next state. Expected errors are EngineError instances.
 */
export function transition(run, command) {
  check(record(command), 'INVALID_COMMAND', 'An engine command object is required.');
  const next = structuredClone(run);
  if (command.type === 'resume') {
    check(next.status === 'cancelled', 'RESUME_NOT_ALLOWED', 'Resume only a cancelled run; uncertain and completed results require reconciliation.', { runId: next.id, status: next.status });
    next.status = 'running';
    next.resumeCount = (next.resumeCount ?? 0) + 1;
    next.revision += 1;
    return next;
  }
  active(next);
  if (next.pipeline === undefined) legacyTransition(next, command);
  else pipelineTransition(next, command);
  next.revision += 1;
  return next;
}

function legacyTransition(next, command) {
  switch (command.type) {
    case 'submitStage': {
      knownStage(command.stage);
      const stage = next.stages[command.stage];
      check(stage.status === 'pending' || stage.status === 'needs_revision', 'INVALID_TRANSITION', 'Submit only a pending stage or a requested revision.', { stage: command.stage, status: stage.status });
      check(stage.attempts.length < next.maxAttempts, 'ATTEMPTS_EXHAUSTED', 'The stage revision budget is exhausted.', { stage: command.stage });
      const value = validateStage(command.stage, command.value, upstreamOf(next, command.stage), next.snapshotMarkdown);
      stage.attempts.push({ attempt: stage.attempts.length + 1, value, review: null });
      if (command.stage === 'cleanup') { stage.status = 'committed'; stage.committed = structuredClone(value); }
      else stage.status = 'awaiting_review';
      break;
    }
    case 'submitReview': {
      const review = { stage: command.stage, attempt: command.attempt, passed: command.passed, issues: command.issues };
      validate(REVIEW_SCHEMA, review);
      check(review.passed ? review.issues.length === 0 : review.issues.length > 0, 'INVALID_REVIEW', 'A passing review has no issues; a failing review requires explicit issues.');
      const stage = next.stages[review.stage];
      check(stage.status === 'awaiting_review', 'INVALID_TRANSITION', 'The stage has no candidate awaiting review.', { stage: review.stage });
      const latest = stage.attempts.at(-1);
      check(latest.attempt === review.attempt, 'STALE_REVIEW', 'Review the current candidate attempt.', { stage: review.stage, expected: latest.attempt, received: review.attempt });
      latest.review = structuredClone(review);
      if (review.passed || stage.attempts.length === next.maxAttempts) {
        stage.committed = structuredClone(latest.value);
        stage.status = 'committed';
      } else stage.status = 'needs_revision';
      break;
    }
    case 'cancel': next.status = 'cancelled'; break;
    case 'markUncertain':
      check(typeof command.reason === 'string' && command.reason.trim().length > 0, 'INVALID_COMMAND', 'Record a reason for the uncertain outcome.');
      next.status = 'result_unverified'; next.problem = command.reason; break;
    default: fail('INVALID_COMMAND', 'Choose submitStage, submitReview, cancel, resume, or markUncertain.', { type: command.type });
  }
}

function pipelineTransition(next, command) {
  switch (command.type) {
    case 'submitStage': {
      knownStage(command.stage);
      const stage = next.stages[command.stage];
      check(stage.status === 'pending' || stage.status === 'needs_revision', 'INVALID_TRANSITION', 'Submit only a pending stage or a requested revision.', { stage: command.stage, status: stage.status });
      check(stage.attempts.length < next.maxAttempts + stage.grants, 'ATTEMPTS_EXHAUSTED', 'The stage revision budget is exhausted.', { stage: command.stage });
      const value = validateStage(command.stage, command.value, upstreamOf(next, command.stage), next.snapshotMarkdown);
      stage.attempts.push({ attempt: stage.attempts.length + 1, value, checks: [] });
      stage.status = 'awaiting_check';
      break;
    }
    case 'submitCheck': {
      const gate = { stage: command.stage, node: command.node, attempt: command.attempt, passed: command.passed, issues: command.issues, actorRole: command.actorRole, judgeRole: command.judgeRole, skill: command.skill };
      validate(CHECK_SCHEMA, gate);
      check(gate.passed ? gate.issues.length === 0 : gate.issues.length > 0, 'INVALID_CHECK', 'A passing check has no issues; a failing check requires explicit issues.');
      knownStage(command.stage);
      const stage = next.stages[gate.stage];
      check(stage.status === 'awaiting_check', 'INVALID_TRANSITION', 'The stage has no candidate awaiting a check.', { stage: gate.stage, status: stage.status });
      const latest = stage.attempts.at(-1);
      check(latest.attempt === gate.attempt, 'STALE_CHECK', 'Check the current candidate attempt.', { stage: gate.stage, expected: latest.attempt, received: gate.attempt });
      const gates = gateNodes(next, gate.stage);
      check(gates[latest.checks.length] === gate.node, 'UNEXPECTED_NODE', `Submit check ${gates[latest.checks.length]} next.`, { stage: gate.stage, expected: gates[latest.checks.length], received: gate.node });
      latest.checks.push(structuredClone(gate));
      if (!gate.passed) stage.status = stage.attempts.length < next.maxAttempts + stage.grants ? 'needs_revision' : 'blocked';
      else if (latest.checks.length === gates.length) {
        stage.committed = structuredClone(latest.value);
        stage.status = 'committed';
      }
      break;
    }
    case 'grantRevision': {
      knownStage(command.stage);
      const stage = next.stages[command.stage];
      check(stage.status === 'blocked', 'INVALID_TRANSITION', 'Only a blocked stage accepts a revision grant.', { stage: command.stage, status: stage.status });
      check(typeof command.reason === 'string' && command.reason.trim().length > 0, 'INVALID_COMMAND', 'Record the explicit reason for the granted revision.');
      stage.grants += 1;
      stage.unblocks.push({ attempt: stage.attempts.length + 1, reason: command.reason });
      stage.status = 'needs_revision';
      break;
    }
    case 'submitReview': fail('INVALID_COMMAND', 'Pipeline runs gate stages with submitCheck instead of submitReview.', { type: command.type });
    case 'cancel': next.status = 'cancelled'; break;
    case 'markUncertain':
      check(typeof command.reason === 'string' && command.reason.trim().length > 0, 'INVALID_COMMAND', 'Record a reason for the uncertain outcome.');
      next.status = 'result_unverified'; next.problem = command.reason; break;
    default: fail('INVALID_COMMAND', 'Choose submitStage, submitCheck, grantRevision, cancel, resume, or markUncertain.', { type: command.type });
  }
}

function completedState(run, artifacts) {
  const next = structuredClone(run);
  next.status = next.pipeline === undefined && STAGES.some((stage) => next.stages[stage].attempts.at(-1)?.review?.passed === false)
    ? 'completed_with_issues' : 'completed';
  next.artifacts = artifacts;
  next.revision += 1;
  return next;
}

/**
 * Async adapter engine. The adapter implements readRun(id), writeRun(id,run),
 * writeArtifact(id,name,text), and readArtifact(id,name). Missing runs return null or undefined;
 * artifact reads return exact text. writeRun must replace atomically or reject with an unknown
 * outcome. The engine serializes one instance's operations; callers must provide exclusive run
 * ownership across instances. Rejected writes quarantine the run in this instance until external
 * reconciliation; a new instance requires the caller to reconcile durable state first.
 * Store input and returned runs are detached copies. Reviewer authorization and model task
 * cancellation remain the caller's responsibility; cancel only commits engine state.
 */
export class AnalysisEngine {
  #store;
  #maxAttempts;
  #queues = new Map();
  #uncertain = new Set();

  /**
   * @param {object} options Async store and required positive integer maxAttempts.
   */
  constructor({ store, maxAttempts }) {
    check(store !== null && typeof store === 'object' && ['readRun', 'writeRun', 'writeArtifact', 'readArtifact'].every((name) => typeof store[name] === 'function'), 'INVALID_CONFIG', 'Provide all four async storage adapter methods.');
    check(Number.isSafeInteger(maxAttempts) && maxAttempts > 0, 'INVALID_CONFIG', 'maxAttempts must be a positive safe integer.');
    this.#store = store;
    this.#maxAttempts = maxAttempts;
  }

  #serialize(id, work) {
    const previous = this.#queues.get(id) ?? Promise.resolve();
    const current = previous.then(() => {
      check(!this.#uncertain.has(id), 'RECONCILIATION_REQUIRED', 'A write outcome is unknown. Reconcile stored state before creating a new engine.', { runId: id });
      return work();
    });
    const settled = current.then(() => undefined, () => undefined);
    this.#queues.set(id, settled);
    void settled.then(() => { if (this.#queues.get(id) === settled) this.#queues.delete(id); });
    return current;
  }

  async #read(id) {
    let run;
    try { run = await this.#store.readRun(id); }
    catch (cause) { throw new EngineError('STORAGE_READ_FAILED', 'Could not read run state; no dependent work was started.', { runId: id }, cause); }
    check(run !== null && run !== undefined, 'RUN_NOT_FOUND', 'The requested run does not exist.', { runId: id });
    check(record(run) && run.id === id && record(run.stages) && Number.isSafeInteger(run.revision)
      && (run.pipeline === undefined || record(run.pipeline)), 'INVALID_STORED_RUN', 'Stored run state is invalid. Reconcile it before continuing.', { runId: id });
    try {
      let replay = createRun(run);
      for (const stage of STAGES) {
        const entry = run.stages[stage];
        check(record(entry) && Array.isArray(entry.attempts), 'INVALID_STORED_RUN', 'Stored stage attempts are invalid.', { runId: id, stage });
        if (run.pipeline === undefined) {
          for (const attempt of entry.attempts) {
            check(record(attempt) && attempt.attempt === replay.stages[stage].attempts.length + 1, 'INVALID_STORED_RUN', 'Stored attempt numbering is invalid.', { runId: id, stage });
            replay = transition(replay, { type: 'submitStage', stage, value: attempt.value });
            if (attempt.review !== null) {
              validate(REVIEW_SCHEMA, attempt.review);
              check(attempt.review.stage === stage, 'INVALID_STORED_RUN', 'Stored review belongs to another stage.', { runId: id, stage });
              replay = transition(replay, { ...attempt.review, type: 'submitReview' });
            }
          }
          continue;
        }
        check(Array.isArray(entry.unblocks) && Number.isSafeInteger(entry.grants) && entry.grants === entry.unblocks.length,
          'INVALID_STORED_RUN', 'Stored revision grants are invalid.', { runId: id, stage });
        const pending = [...entry.unblocks];
        for (const attempt of entry.attempts) {
          check(record(attempt) && attempt.attempt === replay.stages[stage].attempts.length + 1, 'INVALID_STORED_RUN', 'Stored attempt numbering is invalid.', { runId: id, stage });
          while (pending.length && pending[0].attempt <= attempt.attempt) {
            replay = transition(replay, { type: 'grantRevision', stage, reason: pending.shift().reason });
          }
          replay = transition(replay, { type: 'submitStage', stage, value: attempt.value });
          check(Array.isArray(attempt.checks), 'INVALID_STORED_RUN', 'Stored stage checks are invalid.', { runId: id, stage });
          for (const gate of attempt.checks) {
            validate(CHECK_SCHEMA, gate);
            check(gate.stage === stage, 'INVALID_STORED_RUN', 'Stored check belongs to another stage.', { runId: id, stage });
            replay = transition(replay, { ...gate, type: 'submitCheck' });
          }
        }
        while (pending.length) replay = transition(replay, { type: 'grantRevision', stage, reason: pending.shift().reason });
        check(isDeepStrictEqual(run.stages[stage], replay.stages[stage]), 'INVALID_STORED_RUN', 'Stored stage state disagrees with its attempts and checks.', { runId: id, stage });
      }
      if (run.pipeline === undefined) check(isDeepStrictEqual(run.stages, replay.stages), 'INVALID_STORED_RUN', 'Stored stage state disagrees with its attempts and reviews.', { runId: id });
      check(run.resumeCount === undefined || (Number.isSafeInteger(run.resumeCount) && run.resumeCount >= 0), 'INVALID_STORED_RUN', 'Stored resume history is invalid.', { runId: id });
      const resumeCount = run.resumeCount ?? 0;
      for (let index = 0; index < resumeCount; index += 1) {
        replay = transition(replay, { type: 'cancel' });
        replay = transition(replay, { type: 'resume' });
      }
      if (run.status === 'cancelled') replay = transition(replay, { type: 'cancel' });
      else if (run.status === 'result_unverified') replay = transition(replay, { type: 'markUncertain', reason: run.problem });
      else if (run.status === 'completed' || run.status === 'completed_with_issues') {
        check(STAGES.every((stage) => replay.stages[stage].status === 'committed'), 'INVALID_STORED_RUN', 'A completed run has uncommitted stages.', { runId: id });
        replay = completedState(replay, ['testcases.json', 'testcases.md']);
      } else check(run.status === 'running', 'INVALID_STORED_RUN', 'Stored run status is invalid.', { runId: id, status: run.status });
      check(isDeepStrictEqual(run, replay), 'INVALID_STORED_RUN', 'Stored run state disagrees with validated execution history.', { runId: id });
    } catch (cause) {
      throw new EngineError('INVALID_STORED_RUN', 'Stored run state is invalid. Reconcile it before continuing.', { runId: id }, cause);
    }
    return structuredClone(run);
  }

  async #save(run) {
    try { await this.#store.writeRun(run.id, structuredClone(run)); }
    catch (cause) {
      this.#uncertain.add(run.id);
      throw new EngineError('STORAGE_WRITE_UNKNOWN', 'Run write outcome is unknown; stop dependent work and reconcile storage.', { runId: run.id }, cause);
    }
    return structuredClone(run);
  }

  /**
   * Persist a new run, refusing to overwrite an existing ID. A validated pipeline definition
   * switches the run to gate semantics; omitting it creates a legacy run.
   * @param {object} input Unique id, immutable snapshotMarkdown, and optional pipeline definition.
   * @returns {Promise<object>} Persisted initial run.
   */
  async start({ id, snapshotMarkdown, pipeline }) {
    const run = createRun({ id, snapshotMarkdown, maxAttempts: this.#maxAttempts, pipeline });
    return this.#serialize(id, async () => {
      let existing;
      try { existing = await this.#store.readRun(id); }
      catch (cause) { throw new EngineError('STORAGE_READ_FAILED', 'Could not check the run ID; creation was stopped.', { runId: id }, cause); }
      check(existing === null || existing === undefined, 'RUN_EXISTS', 'Use a new run ID; existing runs cannot be overwritten.', { runId: id });
      return this.#save(run);
    });
  }

  /**
   * Read validated stored state in operation order.
   * @param {string} id Run ID.
   * @returns {Promise<object>} Detached stored state, or a typed storage failure.
   */
  get(id) { return this.#serialize(id, () => this.#read(id)); }

  async #apply(id, command) {
    return this.#serialize(id, async () => this.#save(transition(await this.#read(id), command)));
  }

  /**
   * Validate and persist a candidate; reviewed stages remain uncommitted until submitReview.
   * @param {string} id Run ID.
   * @param {object} input Stage and value.
   * @returns {Promise<object>} Persisted candidate state.
   */
  async submitStage(id, { stage, value }) {
    knownStage(stage);
    validate(STAGE_SCHEMAS[stage], value);
    return this.#apply(id, { type: 'submitStage', stage, value: structuredClone(value) });
  }

  /**
   * Persist an independently authorized review of the current attempt.
   * @param {string} id Run ID.
   * @param {object} review Payload conforming to REVIEW_SCHEMA.
   * @returns {Promise<object>} Persisted review and commit or revision state.
   */
  async submitReview(id, review) {
    validate(REVIEW_SCHEMA, review);
    return this.#apply(id, { ...structuredClone(review), type: 'submitReview' });
  }

  /**
   * Persist an independently authorized judge gate result for the current pipeline attempt.
   * The gate must be the stage's next pending node check; a failed gate revises or blocks.
   * @param {string} id Run ID.
   * @param {object} gate Payload conforming to CHECK_SCHEMA.
   * @returns {Promise<object>} Persisted check and commit, revision, or blocked state.
   */
  async submitCheck(id, gate) {
    validate(CHECK_SCHEMA, gate);
    return this.#apply(id, { ...structuredClone(gate), type: 'submitCheck' });
  }

  /**
   * Reopen one blocked stage for exactly one more revision. The caller must record the user's
   * explicit reason; automation cannot unblock a stage implicitly.
   * @param {string} id Run ID.
   * @param {object} input Stage and nonempty reason.
   * @returns {Promise<object>} Persisted revision grant.
   */
  grantRevision(id, { stage, reason }) {
    return this.#apply(id, { type: 'grantRevision', stage, reason });
  }

  /**
   * Persist cancellation. The caller must separately stop model tasks before claiming task cancellation.
   * @param {string} id Run ID.
   * @returns {Promise<object>} Persisted cancelled state.
   */
  cancel(id) { return this.#apply(id, { type: 'cancel' }); }

  /**
   * Resume only a durably cancelled run; uncertain and completed runs are never retryable.
   * Stage attempts and committed outputs remain unchanged, and every resume is revisioned.
   * @param {string} id Run ID.
   * @returns {Promise<object>} Persisted running checkpoint.
   */
  resume(id) { return this.#apply(id, { type: 'resume' }); }

  /**
   * Record interrupted execution or an externally detected uncertain outcome; this stops advancement.
   * @param {string} id Run ID.
   * @param {string} reason Actionable recovery information.
   * @returns {Promise<object>} Persisted result_unverified state.
   */
  markUncertain(id, reason) { return this.#apply(id, { type: 'markUncertain', reason }); }

  /**
   * Write and read back final JSON and Markdown only after every stage commits. Artifact failures
   * persist result_unverified and reject; a checkpoint write failure has unknown outcome and
   * quarantines the run. Adapter cleanup and recovery belong to the caller. A successful return
   * verifies readability at this instant, not continued availability after return.
   * @param {string} id Run ID.
   * @returns {Promise<object>} Persisted completed or completed_with_issues run.
   */
  finalize(id) {
    return this.#serialize(id, async () => {
      const run = await this.#read(id);
      active(run);
      check(STAGES.every((stage) => run.stages[stage].status === 'committed'), 'MISSING_DEPENDENCY', 'Commit every stage and its required review before finalizing.', { runId: id });
      const value = validateStage('testcases', run.stages.testcases.committed, upstreamOf(run, 'testcases'), run.snapshotMarkdown);
      const artifacts = { 'testcases.json': `${JSON.stringify(value, null, 2)}\n`, 'testcases.md': renderTestcases(value) };
      try {
        for (const [name, text] of Object.entries(artifacts)) await this.#store.writeArtifact(id, name, text);
        for (const [name, text] of Object.entries(artifacts)) {
          const actual = await this.#store.readArtifact(id, name);
          check(actual === text, 'ARTIFACT_MISMATCH', `Artifact ${name} is missing or differs from the committed output.`, { runId: id, name });
        }
      } catch (cause) {
        const uncertain = transition(run, { type: 'markUncertain', reason: 'Final artifacts could not be verified. Inspect saved files and reconcile the run before continuing.' });
        await this.#save(uncertain);
        throw new EngineError('ARTIFACT_VERIFICATION_FAILED', uncertain.problem, { runId: id, status: uncertain.status }, cause);
      }
      return this.#save(completedState(run, Object.keys(artifacts)));
    });
  }
}
