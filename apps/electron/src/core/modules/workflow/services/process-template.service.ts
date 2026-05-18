import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { injectable } from 'tsyringe';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { LocalizedText } from '@shared/locale/types';
import type { ProcessSchema } from '../types/workflow.types';

export interface ProcessTemplate {
  id: string;
  name: string;
  /** Short one-line hook shown on template cards. Localized. */
  summary: LocalizedText;
  /** Long-form description shown in the info dialog. Localized. */
  description: LocalizedText;
  schema: ProcessSchema;
}

@injectable()
export class ProcessTemplateService {
  private templates: ProcessTemplate[] = [];

  constructor(
    private readonly logger: ILogger,
    private readonly workflowsDir: string,
  ) {}

  loadTemplatesFromDisk(): ProcessTemplate[] {
    if (!existsSync(this.workflowsDir)) {
      this.logger.warn('Workflows directory not found', { path: this.workflowsDir });
      return [];
    }

    this.templates = [];
    const files = readdirSync(this.workflowsDir).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      try {
        const raw = readFileSync(join(this.workflowsDir, file), 'utf-8');
        const template = JSON.parse(raw) as ProcessTemplate;
        this.templates.push(template);
      } catch (err) {
        this.logger.error('Failed to load workflow template', { file, error: String(err) });
      }
    }
    return this.templates;
  }

  getTemplates(): ProcessTemplate[] {
    return this.templates;
  }

  getTemplate(id: string): ProcessTemplate | null {
    return this.templates.find((t) => t.id === id) ?? null;
  }
}
