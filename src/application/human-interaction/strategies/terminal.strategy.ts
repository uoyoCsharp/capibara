/**
 * Terminal Interaction Strategy - Interacts with users via stdin/stdout
 * @module application/human-interaction/strategies/terminal
 */

import * as readline from 'node:readline';
import type { IHumanInteractionStrategy, InterventionContext } from './human-interaction.strategy.js';
import type { HumanResponse } from '../human-interaction.handler.js';

/** Maximum output display length */
const MAX_OUTPUT_DISPLAY = 2000;

export class TerminalStrategy implements IHumanInteractionStrategy {
  async requestApproval(context: InterventionContext): Promise<HumanResponse> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise<HumanResponse>((resolve) => {
      this.displayContext(context);

      rl.question('\nApprove? (y/n): ', (answer) => {
        const approved = answer.toLowerCase().startsWith('y');

        if (!approved) {
          rl.question('Feedback: ', (feedback) => {
            rl.close();
            resolve({ approved: false, feedback });
          });
        } else {
          rl.close();
          resolve({ approved: true, feedback: '' });
        }
      });
    });
  }

  private displayContext(context: InterventionContext): void {
    console.log('\n' + '='.repeat(60));
    console.log('  HUMAN INTERVENTION REQUEST');
    console.log('='.repeat(60));
    console.log(`Pipeline: ${context.pipelineId}`);
    console.log(`Change:   ${context.changeId}`);
    console.log(`Phase:    ${context.phase}`);
    console.log(`Round:    ${context.round}`);
    console.log(`Mode:     ${context.mode}`);
    console.log('='.repeat(60));

    // Display escalate reason for semi-auto mode
    if (context.escalateReason) {
      console.log('\n## Escalate Reason');
      console.log(context.escalateReason);
    }

    // Display recent interactions (last 3 rounds)
    if (context.recentInteractions.length > 0) {
      console.log('\n## Recent Interactions');
      for (let i = 0; i < context.recentInteractions.length; i++) {
        const record = context.recentInteractions[i];
        console.log(`\n### Round ${record.round} (Phase: ${record.phase})`);
        console.log(`Decision: ${record.conductorDecision}`);
        console.log(`Reason:   ${record.conductorReason}`);
        if (record.feedback) {
          console.log(`Feedback: ${record.feedback.slice(0, 200)}${record.feedback.length > 200 ? '...' : ''}`);
        }
        console.log(`Output:   ${this.truncateForDisplay(record.workerOutput, 300)}`);
      }
    }

    // Display current output
    console.log('\n## Current Output');
    if (context.evaluatorResults && context.evaluatorResults.length > 0) {
      console.log('\n### Evaluator Results');
      for (const result of context.evaluatorResults) {
        console.log(`- ${this.truncateForDisplay(result, 300)}`);
      }
    }

    console.log('\n### Worker Output');
    console.log(this.truncateForDisplay(context.currentOutput, MAX_OUTPUT_DISPLAY));

    console.log('\n' + '-'.repeat(60));
  }

  private truncateForDisplay(text: string, maxLength: number): string {
    if (!text) return '(no content)';
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + '\n... [truncated, full output available in artifacts]';
  }
}
