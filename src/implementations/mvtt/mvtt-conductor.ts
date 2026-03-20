/**
 * MVTT Conductor Implementation
 *
 * Pure LLM decision-making based on Messenger-prepared plain text input.
 * Maintains MVTT workflow knowledge for phase-aware decisions.
 * @module implementations/mvtt/mvtt-conductor
 */

import type { IConductor } from '../../core/interfaces/conductor.interface.js';
import type { ICommandExecutor } from '../../core/interfaces/command-executor.interface.js';
import type { ConductorDecision } from '../../core/types/conductor.types.js';
import type { MvttOutputParser } from './mvtt-output-parser.js';
import type { AutomationConfig } from '../../core/types/config.types.js';
import type { Logger } from 'pino';
import { ROLE_PERMISSIONS } from '../../core/constants/permissions.js';

const CONDUCTOR_SYSTEM_PROMPT = `You are a decision coordinator in a software development pipeline. Based on the provided evaluation summary, make a decision.

Your options:
- "approve": The work is acceptable and can proceed to the next phase
- "revise": The work has issues that need to be addressed — provide specific feedback
- "escalate": The work has fundamental problems requiring human intervention

Output JSON:
{"action": "approve|revise|escalate", "reason": "brief explanation", "feedback": ["specific suggestion 1", "..."], "priority": "critical|normal"}

Rules:
1. Only use "escalate" for truly unresolvable issues
2. For "revise", always provide actionable feedback items
3. For "approve", feedback array can be omitted
4. Be decisive — avoid ambiguous recommendations`;

const MVTT_WORKFLOW_KNOWLEDGE = `
## MVTT Workflow

The software development pipeline follows this workflow:
  analyze → design → implement → review → test

Phase descriptions:
- analyze: Requirements analysis — produces structured requirement breakdown
- design: Architecture design — produces technical blueprint based on analysis
- implement: Code implementation — produces working code based on design
- review: Code review — produces review feedback on implementation quality
- test: Testing — produces test results validating implementation

Key principles:
- Each phase's output must be sufficient to support the next phase
- Earlier phases (analyze, design) should prioritize completeness and clarity
- Later phases (review, test) should validate against earlier phase outputs
- "approve" means the output is ready for the downstream consumer
`;

const WORKFLOW_PHASES = ['analyze', 'design', 'implement', 'review', 'test'] as const;

const PHASE_DOWNSTREAM_NEEDS: Record<string, string> = {
  analyze: 'Design phase needs clear, structured requirements with acceptance criteria',
  design: 'Implement phase needs precise technical blueprint with interfaces and data flow',
  implement: 'Review phase needs working code that follows the design blueprint',
  review: 'Test phase needs validated, reviewed code ready for testing',
  test: 'Pipeline completion — test results confirm implementation correctness',
};

export class MvttConductor implements IConductor {
  constructor(
    private executor: ICommandExecutor,
    private outputParser: MvttOutputParser,
    private config: AutomationConfig,
    private logger: Logger,
  ) {}

  async decide(input: string): Promise<ConductorDecision> {
    this.logger.info('Conductor making decision via LLM');

    const phaseContext = this.buildPhaseContext(input);

    const response = await this.executor.execute({
      input: [
        'Please analyze the following evaluation summary and make a decision.',
        '',
        phaseContext,
        '',
        'Evaluation summary:',
        input,
      ].join('\n'),
      systemPrompt: CONDUCTOR_SYSTEM_PROMPT + '\n' + MVTT_WORKFLOW_KNOWLEDGE,
      options: {
        disallowedTools: ROLE_PERMISSIONS.conductor.disallowed,
        maxTurns: this.config.conductor.maxTurns,
        outputFormat: 'json',
      },
    });

    const decision = this.outputParser.parseConductorDecision(response);
    this.logger.info({ action: decision.action, reason: decision.reason }, 'Conductor decided');
    return decision;
  }

  private buildPhaseContext(input: string): string {
    const phase = this.extractPhase(input);
    if (!phase) return '';

    const idx = WORKFLOW_PHASES.indexOf(phase as (typeof WORKFLOW_PHASES)[number]);
    if (idx === -1) return '';

    const upstream = WORKFLOW_PHASES.slice(0, idx);
    const downstream = WORKFLOW_PHASES.slice(idx + 1);

    return [
      'Current Phase Context:',
      `- Phase: ${phase}`,
      `- Position: ${idx + 1} of ${WORKFLOW_PHASES.length} in workflow`,
      `- Upstream: ${upstream.length > 0 ? upstream.join(' → ') : '(none)'}`,
      `- Downstream: ${downstream.length > 0 ? downstream.join(' → ') : '(none)'}`,
      `- Downstream needs: ${PHASE_DOWNSTREAM_NEEDS[phase] ?? 'N/A'}`,
    ].join('\n');
  }

  private extractPhase(input: string): string | undefined {
    const firstLine = input.split('\n')[0];
    const match = firstLine.match(/Phase:\s*(\S+)/);
    return match?.[1];
  }
}
