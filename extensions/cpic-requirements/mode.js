/** Scoped case-design tool supplied by the built-in business preset. */
import { METHODS, REVIEW_METHOD } from './methods.js'
export const name = 'cpic-case-design-mode'
export const inject = ['tools', 'skills', 'agentPresets']
export function apply(ctx) {
  const requirements = () => {
    const value = ctx.root.reflect.get('cpicRequirements')
    if (!value) throw new Error('CPICHarness Host service cpicRequirements is unavailable')
    return value
  }
  ctx.effect(() => ctx.skills.register({
    name: 'cpic-case-design', source: 'runtime',
    description: 'Requirement clarification, feature extraction, outline, outline review, case writing and case review methods for the case-design pipeline.',
    whenToUse: 'Designing tests from a fixed requirement snapshot in CPICHarness.',
    resourceBase: { kind: 'opaque', description: 'Methods bundled with the CPICHarness case-design mode' },
    content: Object.entries(METHODS).map(([stage, method]) => `## ${stage}\n\n${method}`).join('\n\n') + `\n\n## Review\n\n${REVIEW_METHOD}`,
  }), 'cpic.caseDesignSkill')
  ctx.effect(() => ctx.tools.guard(execution => execution.agent?.session.header.origin === 'subagent' && !['structured_output', 'skill'].includes(execution.name)
    ? 'Case-design workers return structured output only; external operations are disabled.' : undefined), 'cpic.workerPolicy')
  ctx.effect(() => ctx.tools.register({
    name: 'case_design',
    description: 'Read this Session’s fixed requirement, pipeline configuration and committed analysis, or execute the next pipeline node (its bound role agent, then its independent judge gate). Use status first, then advance until completion. When status is waiting_input, ask the user the committed cleanup questions. If the user delegates a material decision, ask whether to keep it unresolved, include labeled provisional recommendations, or let the model choose the most reasonable interpretation for the listed gaps. Label model judgments as pending confirmation; do not choose this option for the user. Then call clarify with their actual answer and selected mode before advancing. When a node is blocked by its judge, review the judge issues and revision plan with the user, then call unblock with their explicit agreed reason to grant exactly one revision before advancing again. bind accepts manually supplied Markdown for a case-design Session without a requirement entry. Cancel stops the current analysis.',
    parameters: { type: 'object', properties: { action: { type: 'string', enum: ['status', 'advance', 'bind', 'clarify', 'unblock', 'cancel'] }, markdown: { type: 'string' }, title: { type: 'string' }, answer: { type: 'string' }, reason: { type: 'string' } }, required: ['action'], additionalProperties: false },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: (args, execution) => requirements().caseOperation(args, execution),
    presentCall: args => ({ card: 'generic', title: `Case design · ${args.action}`, kind: args.action === 'status' ? 'read' : 'execute' }),
  }), 'cpic.caseDesignTool')
}
