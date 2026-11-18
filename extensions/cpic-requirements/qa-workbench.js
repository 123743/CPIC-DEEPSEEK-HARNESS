import { randomUUID } from 'node:crypto'
import { digest, WorkbenchError } from './business.js'
import { validateStage } from './engine.js'

const fail = (code, message) => { throw new WorkbenchError(code, message) }
const nonempty = value => typeof value === 'string' && value.trim().length > 0

/** Owns tenant-local QA projects, testcase plans, manual runs, defects and gate decisions. */
export class QualityWorkbench {
  constructor({ tables, files, requirements, identity }) {
    this.tables = tables
    this.files = files
    this.requirements = requirements
    this.identity = identity
    this.tail = Promise.resolve()
  }

  enqueue(operation) {
    const result = this.tail.then(operation)
    this.tail = result.then(() => undefined, () => undefined)
    return result
  }

  list() {
    return {
      projects: [...this.tables.qa_projects.entries()].map(([, value]) => value),
      plans: [...this.tables.qa_plans.entries()].map(([, value]) => value),
      executions: [...this.tables.qa_executions.entries()].map(([, value]) => value),
      defects: [...this.tables.qa_defects.entries()].map(([, value]) => value),
      audits: [...this.tables.qa_audits.entries()].map(([, value]) => value),
      requirements: this.requirements.list(),
      runs: this.requirements.listPanelRuns(),
    }
  }

  async createProject({ name, description = '' }) {
    if (!nonempty(name)) fail('INVALID_INPUT', 'Project name is required')
    const now = new Date().toISOString()
    const project = { id: randomUUID(), name: name.trim(), description, status: 'active', version: 1, createdAt: now, updatedAt: now }
    await this.tables.qa_projects.put(project.id, project)
    return project
  }

  async importPlan({ projectId, runId }) {
    return this.enqueue(async () => {
      const project = this.tables.qa_projects.get(projectId)
      if (!project) fail('PROJECT_NOT_FOUND', 'Project does not exist')
      if (!nonempty(runId)) fail('INVALID_INPUT', 'Completed case-design run is required')
      const record = this.requirements.runRecord(runId)
      if (!record || !record.engine || !['completed', 'completed_with_issues'].includes(record.engine.status)) {
        fail('RUN_NOT_COMPLETE', 'Only a completed case-design run can be imported')
      }
      const snapshotText = await this.files.read(record.snapshot.path)
      if (digest(snapshotText) !== record.snapshot.hash) fail('SNAPSHOT_CHANGED', 'The saved requirement snapshot has changed')
      const engine = record.engine
      const stages = Object.fromEntries(['cleanup', 'features', 'outline'].map(stage => [stage, engine.stages[stage].committed]))
      const cases = validateStage('testcases', engine.stages.testcases.committed, stages, snapshotText).testcases
      const sourceHash = digest(JSON.stringify([runId, record.snapshot.id, cases]))
      const existing = [...this.tables.qa_plans.entries()].find(([, plan]) => plan.projectId === projectId && plan.sourceRunId === runId)
      if (existing) return existing[1]
      const now = new Date().toISOString()
      const plan = {
        id: randomUUID(), projectId, sourceRunId: runId, requirementId: record.requirementId,
        snapshotId: record.snapshot.id, snapshotHash: record.snapshot.hash, sourceHash,
        cases, version: 1, status: 'draft', createdAt: now, updatedAt: now,
      }
      await this.tables.qa_plans.put(plan.id, plan)
      await this.audit({ projectId, entityType: 'testcase-plan', entityId: plan.id, entityVersion: plan.version, action: 'import', reason: 'Imported validated cases from completed case-design run' })
      return plan
    })
  }

  async reviewPlan({ planId, version, decision, reason = '' }) {
    return this.enqueue(async () => {
      const plan = this.tables.qa_plans.get(planId)
      if (!plan) fail('PLAN_NOT_FOUND', 'Testcase plan does not exist')
      if (plan.version !== version) fail('VERSION_CONFLICT', 'The plan changed; refresh before reviewing')
      if (!['approve', 'reject'].includes(decision)) fail('INVALID_INPUT', 'Choose approve or reject')
      if (decision === 'reject' && !nonempty(reason)) fail('REASON_REQUIRED', 'A reason is required when rejecting a plan')
      const updated = { ...plan, status: decision === 'approve' ? 'approved' : 'rejected', reviewedVersion: plan.version, updatedAt: new Date().toISOString() }
      await this.tables.qa_plans.put(planId, updated)
      await this.audit({ projectId: plan.projectId, entityType: 'testcase-plan', entityId: plan.id, entityVersion: plan.version, action: decision, reason })
      return updated
    })
  }

  async recordExecution({ planId, version, testcaseId, result, note = '', evidence = '' }) {
    return this.enqueue(async () => {
      const plan = this.tables.qa_plans.get(planId)
      if (!plan) fail('PLAN_NOT_FOUND', 'Testcase plan does not exist')
      if (plan.status !== 'approved' || plan.reviewedVersion !== plan.version) fail('PLAN_NOT_APPROVED', 'Approve the current testcase-plan version before execution')
      if (plan.version !== version) fail('VERSION_CONFLICT', 'The plan changed; refresh before recording results')
      if (!plan.cases.some(testcase => testcase.id === testcaseId)) fail('TESTCASE_NOT_FOUND', 'Testcase does not belong to this plan')
      if (!['passed', 'failed', 'blocked'].includes(result)) fail('INVALID_INPUT', 'Execution result must be passed, failed or blocked')
      const now = new Date().toISOString()
      const execution = { id: randomUUID(), projectId: plan.projectId, planId, planVersion: version, testcaseId, result, note, evidence, actor: this.identity, createdAt: now }
      await this.tables.qa_executions.put(execution.id, execution)
      await this.audit({ projectId: plan.projectId, entityType: 'testcase-execution', entityId: execution.id, entityVersion: version, action: result, reason: note })
      return execution
    })
  }

  async createDefect({ projectId, planId, testcaseId, title, description = '', severity = 'major' }) {
    return this.enqueue(async () => {
      const project = this.tables.qa_projects.get(projectId)
      const plan = this.tables.qa_plans.get(planId)
      if (!project || !plan || plan.projectId !== projectId) fail('PROJECT_NOT_FOUND', 'Project or linked testcase plan does not exist')
      if (!plan.cases.some(testcase => testcase.id === testcaseId)) fail('TESTCASE_NOT_FOUND', 'Testcase does not belong to this plan')
      if (!nonempty(title) || !['critical', 'major', 'minor', 'trivial'].includes(severity)) fail('INVALID_INPUT', 'Defect title and supported severity are required')
      const now = new Date().toISOString()
      const defect = { id: randomUUID(), projectId, planId, testcaseId, title: title.trim(), description, severity, status: 'open', version: 1, createdAt: now, updatedAt: now }
      await this.tables.qa_defects.put(defect.id, defect)
      await this.audit({ projectId, entityType: 'defect', entityId: defect.id, entityVersion: defect.version, action: 'created', reason: title })
      return defect
    })
  }

  async updateDefect({ defectId, version, status, reason = '' }) {
    return this.enqueue(async () => {
      const defect = this.tables.qa_defects.get(defectId)
      if (!defect) fail('DEFECT_NOT_FOUND', 'Defect does not exist')
      if (defect.version !== version) fail('VERSION_CONFLICT', 'The defect changed; refresh before updating')
      if (!['open', 'fixed', 'verified', 'closed'].includes(status)) fail('INVALID_INPUT', 'Choose a supported defect status')
      const updated = { ...defect, status, version: defect.version + 1, updatedAt: new Date().toISOString() }
      await this.tables.qa_defects.put(defectId, updated)
      await this.audit({ projectId: defect.projectId, entityType: 'defect', entityId: defect.id, entityVersion: updated.version, action: status, reason })
      return updated
    })
  }

  report(projectId) {
    const project = this.tables.qa_projects.get(projectId)
    if (!project) fail('PROJECT_NOT_FOUND', 'Project does not exist')
    const plans = [...this.tables.qa_plans.entries()].map(([, plan]) => plan).filter(plan => plan.projectId === projectId)
    const planIds = new Set(plans.map(plan => plan.id))
    const executions = [...this.tables.qa_executions.entries()].map(([, item]) => item).filter(item => planIds.has(item.planId))
    const defects = [...this.tables.qa_defects.entries()].map(([, item]) => item).filter(item => item.projectId === projectId)
    const totalCases = plans.reduce((sum, plan) => sum + plan.cases.length, 0)
    const latest = new Map()
    for (const execution of executions) latest.set(`${execution.planId}:${execution.testcaseId}`, execution)
    const results = [...latest.values()]
    const unresolved = defects.filter(defect => !['verified', 'closed'].includes(defect.status))
    return {
      project, plans, totalCases, executedCases: results.length,
      passedCases: results.filter(item => item.result === 'passed').length,
      failedCases: results.filter(item => item.result === 'failed').length,
      blockedCases: results.filter(item => item.result === 'blocked').length,
      openDefects: unresolved.length,
      gate: totalCases === 0 || plans.some(plan => plan.status !== 'approved') || unresolved.some(defect => defect.severity === 'critical')
        ? 'blocked'
        : results.length < totalCases || results.some(item => item.result !== 'passed') ? 'review' : 'pass',
    }
  }

  async audit({ projectId, entityType, entityId, entityVersion, action, reason }) {
    const item = { id: randomUUID(), projectId, entityType, entityId, entityVersion, action, reason, actor: this.identity, createdAt: new Date().toISOString() }
    await this.tables.qa_audits.put(item.id, item)
    return item
  }
}
