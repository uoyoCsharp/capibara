/**
 * Terminal Interaction Strategy - Interacts with users via stdin/stdout
 * @module application/human-interaction/strategies/terminal
 */

import * as readline from 'node:readline';
import type { IHumanInteractionStrategy } from './human-interaction.strategy.js';
import type { PipelineContext } from '../../../core/types/pipeline.types.js';
import type { HumanResponse } from '../human-interaction.handler.js';

export class TerminalStrategy implements IHumanInteractionStrategy {
  async requestApproval(context: PipelineContext, reason: string): Promise<HumanResponse> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise<HumanResponse>((resolve) => {
      console.log('\n========================================');
      console.log(`Pipeline: ${context.pipelineId}`);
      console.log(`Phase: ${context.currentPhase}`);
      console.log(`Reason: ${reason}`);
      console.log('========================================');

      rl.question('Approve? (y/n): ', (answer) => {
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
}
