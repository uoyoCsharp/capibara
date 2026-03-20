/**
 * Pipeline Definition Loader
 *
 * Loads PipelineDefinition from YAML/JSON files.
 * Falls back to DefaultPipelineFactory when no custom file is configured.
 * @module infrastructure/pipeline/pipeline-definition-loader
 */

import { readFileSync, existsSync } from 'node:fs';
import { extname } from 'node:path';
import type { PipelineDefinition } from '../../core/types/dag.types.js';
import type { Logger } from 'pino';
import { createDefaultPipelineDefinition } from './default-pipeline.factory.js';

export class PipelineDefinitionLoader {
  constructor(private logger: Logger) {}

  /**
   * Load pipeline definition from file or return default
   * @param filePath Optional path to YAML/JSON definition file
   */
  async load(filePath?: string): Promise<PipelineDefinition> {
    if (!filePath || !existsSync(filePath)) {
      this.logger.info('No pipeline definition file, using default linear pipeline');
      return createDefaultPipelineDefinition();
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      const ext = extname(filePath).toLowerCase();

      if (ext === '.json') {
        return JSON.parse(content) as PipelineDefinition;
      }

      if (ext === '.yaml' || ext === '.yml') {
        try {
          // Dynamic import to avoid hard dependency — users install 'yaml' when needed
          const yaml = await (Function('return import("yaml")')() as Promise<{ parse: (s: string) => unknown }>);
          return yaml.parse(content) as PipelineDefinition;
        } catch {
          throw new Error(
            `YAML pipeline definition requires 'yaml' package. Install with: pnpm add yaml`,
          );
        }
      }

      throw new Error(`Unsupported pipeline definition format: ${ext}`);
    } catch (err) {
      this.logger.error({ err, filePath }, 'Failed to load pipeline definition, using default');
      return createDefaultPipelineDefinition();
    }
  }
}
