/**
 * .ai-agents Framework Implementation
 * Adapts the .ai-agents prompt engineering structure to IPromptFramework interface
 * @module infrastructure/prompt-framework/ai-agents-framework
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { IPromptFramework } from '../../core/interfaces/prompt-framework.interface.js';
import type {
  AgentDefinition,
  KnowledgeDefinition,
  EvaluationCriteria,
  PhaseConfig,
} from '../../core/types/prompt-framework.types.js';
import type { Phase } from '../../core/types/phase.types.js';

/** Default phases for .ai-agents framework */
const AI_AGENTS_PHASES: PhaseConfig[] = [
  { id: 'analyze', name: 'Analysis', description: 'Requirements analysis phase' },
  { id: 'design', name: 'Design', description: 'Architecture design phase', dependencies: ['analyze'] },
  { id: 'implement', name: 'Implementation', description: 'Code implementation phase', dependencies: ['design'] },
  { id: 'review', name: 'Review', description: 'Code review phase', dependencies: ['implement'] },
  { id: 'test', name: 'Testing', description: 'Testing phase', dependencies: ['review'] },
];

/** Agent file mapping - encapsulated within this adapter */
const AGENT_FILE_MAP: Record<string, { agent: string; command: string }> = {
  analyze: { agent: 'agents/analyst.md', command: 'agents/_commands/analyze.md' },
  design: { agent: 'agents/architect.md', command: 'agents/_commands/design.md' },
  implement: { agent: 'agents/developer.md', command: 'agents/_commands/implement.md' },
  review: { agent: 'agents/reviewer.md', command: 'agents/_commands/review.md' },
  test: { agent: 'agents/tester.md', command: 'agents/_commands/test.md' },
};

/** Knowledge file mapping by phase */
const KNOWLEDGE_FILE_MAP: Record<string, string[]> = {
  analyze: ['patterns/ddd.md'],
  design: ['patterns/clean-architecture.md'],
  implement: ['patterns/clean-architecture.md'],
  review: ['patterns/clean-architecture.md'],
  test: [],
};

/**
 * .ai-agents framework adapter
 */
export class AiAgentsFramework implements IPromptFramework {
  readonly name = 'mvtt';
  readonly version = '1.0.0';

  private cache = new Map<string, string>();

  constructor(private readonly frameworkDir: string) {}

  /**
   * Load a file from the framework directory
   * @param relativePath Path relative to framework root
   * @returns File content or empty string if not found
   */
  private async loadFile(relativePath: string): Promise<string> {
    const cached = this.cache.get(relativePath);
    if (cached !== undefined) {
      return cached;
    }

    const fullPath = join(this.frameworkDir, relativePath);
    if (!existsSync(fullPath)) {
      this.cache.set(relativePath, '');
      return '';
    }

    try {
      const content = await readFile(fullPath, 'utf-8');
      this.cache.set(relativePath, content);
      return content;
    } catch {
      this.cache.set(relativePath, '');
      return '';
    }
  }

  async getAgent(phase: Phase): Promise<AgentDefinition> {
    const mapping = AGENT_FILE_MAP[phase];
    if (!mapping) {
      throw new Error(`[AiAgentsFramework] Unknown phase: ${phase}`);
    }

    const [rolePrompt, commandPrompt, sharedRules] = await Promise.all([
      this.loadFile(mapping.agent),
      this.loadFile(mapping.command),
      this.loadFile('agents/_shared.md'),
    ]);

    return {
      rolePrompt,
      commandPrompt,
      sharedRules: sharedRules || undefined,
    };
  }

  async getKnowledge(phase: Phase): Promise<KnowledgeDefinition> {
    const files = KNOWLEDGE_FILE_MAP[phase] ?? [];

    const patterns = await Promise.all(files.map((f) => this.loadFile(`knowledge/${f}`)));

    return {
      patterns: patterns.filter(Boolean),
      references: [],
    };
  }

  async getEvaluationCriteria(phase: Phase): Promise<EvaluationCriteria> {
    const specific = await this.loadFile(`evaluation-criteria/${phase}.md`);

    if (specific) {
      return {
        items: [{ description: specific }],
        rawContent: specific,
      };
    }

    // Default generic evaluation criteria
    return {
      items: [
        { description: 'Does the artifact fully cover requirement points', severity: 'major' },
        { description: 'Does it follow project architecture specifications', severity: 'major' },
        { description: 'Are there any security risks', severity: 'critical', category: 'security' },
        { description: 'Code/design maintainability', severity: 'minor' },
        { description: 'Consistency with previous phase outputs', severity: 'major' },
      ],
    };
  }

  getSupportedPhases(): PhaseConfig[] {
    return [...AI_AGENTS_PHASES];
  }

  supportsPhase(phase: Phase): boolean {
    return phase in AGENT_FILE_MAP;
  }

  async validate(): Promise<boolean> {
    // Check if framework directory exists and has expected structure
    const shared = await this.loadFile('agents/_shared.md');
    return shared.length > 0;
  }

  clearCache(): void {
    this.cache.clear();
  }
}
