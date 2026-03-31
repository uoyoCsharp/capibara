import { injectable, inject } from 'tsyringe';
import type { ITaskRepository } from '@main/core/interfaces/i-task.repository.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { TaskNode } from '@main/core/types/domain.types.js';
import type { CapibaraConfig } from '@main/core/types/config.types.js';
import { CONFIG_TOKEN, TASK_REPO_TOKEN, LOGGER_TOKEN } from '@main/core/tokens.js';

export interface DecompositionAdvice {
  complexityScore: number; // 0-100
  recommendedDepth: number; // 1-4
  warnings: string[];
}

const COMPLEXITY_KEYWORDS: Record<string, number> = {
  integration: 15,
  migration: 15,
  refactor: 10,
  security: 12,
  authentication: 12,
  authorization: 10,
  database: 10,
  api: 8,
  performance: 10,
  distributed: 15,
  concurrent: 12,
  realtime: 10,
  multi: 8,
  complex: 10,
  legacy: 10,
};

@injectable()
export class DecompositionAdvisor {
  private readonly maxDepth: number;

  constructor(
    @inject(CONFIG_TOKEN) config: CapibaraConfig,
    @inject(TASK_REPO_TOKEN) private readonly taskRepo: ITaskRepository,
    @inject(LOGGER_TOKEN) private readonly logger: ILogger,
  ) {
    this.maxDepth = config.execution.maxDecompositionDepth;
  }

  async assess(task: TaskNode): Promise<DecompositionAdvice> {
    const textLower = `${task.title} ${task.description}`.toLowerCase();
    const warnings: string[] = [];

    // Keyword-based complexity scoring
    let score = 0;
    for (const [keyword, weight] of Object.entries(COMPLEXITY_KEYWORDS)) {
      if (textLower.includes(keyword)) {
        score += weight;
      }
    }

    // Description length heuristic (longer = likely more complex)
    const descLength = task.description.length;
    if (descLength > 1000) score += 15;
    else if (descLength > 500) score += 10;
    else if (descLength > 200) score += 5;

    score = Math.min(100, score);

    // Recommended depth from score
    let recommendedDepth: number;
    if (score >= 60) recommendedDepth = 4;
    else if (score >= 40) recommendedDepth = 3;
    else if (score >= 20) recommendedDepth = 2;
    else recommendedDepth = 1;

    recommendedDepth = Math.min(recommendedDepth, this.maxDepth);

    // Check for over/under-decomposition
    const children = await this.taskRepo.findByParentId(task.id);
    const currentDepth = task.depth;

    if (score < 20 && currentDepth > 2) {
      warnings.push(
        `Low-complexity task decomposed to depth ${currentDepth}. Consider flattening.`,
      );
    }

    if (score >= 50 && children.length === 0 && task.type !== 'subtask') {
      warnings.push(
        'High-complexity task has no subtasks. Consider decomposing further.',
      );
    }

    if (warnings.length > 0) {
      this.logger.info('Decomposition advice generated with warnings', {
        taskId: task.id,
        score,
        recommendedDepth,
        warnings,
      });
    }

    return { complexityScore: score, recommendedDepth, warnings };
  }
}
