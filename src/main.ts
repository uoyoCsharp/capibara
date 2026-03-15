#!/usr/bin/env node
/**
 * CLI Entry Point - Uses commander to parse command line arguments
 * @module main
 */

import 'reflect-metadata';
import { createRequire } from 'module';
import { Command } from 'commander';
import { bootstrap } from './composition-root.js';
import type { InteractionMode } from './core/types/phase.types.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as {
  name: string;
  version: string;
  description: string;
  cli_prefix: string;
};

const program = new Command();

program.name(pkg.cli_prefix).description(pkg.description).version(pkg.version);

program
  .command('run')
  .description('Manually trigger a requirement into the development pipeline')
  .requiredOption('-t, --title <title>', 'Requirement title')
  .requiredOption('-d, --description <desc>', 'Requirement description')
  .option('-m, --mode <mode>', 'Interaction mode: auto | semi-auto | manual', 'semi-auto')
  .option('-c, --config <path>', 'Config file path')
  .action(async (opts) => {
    try {
      const pipeline = bootstrap(opts.config);
      const result = await pipeline.run(
        {
          id: `manual-${Date.now()}`,
          title: opts.title,
          description: opts.description,
          source: 'manual',
          metadata: {},
          createdAt: new Date().toISOString(),
        },
        opts.mode as InteractionMode,
      );
      console.log(`\n✅ Pipeline completed: ${result.changeId}`);
      console.log(`   Total cost: $${result.totalCost.toFixed(2)}`);
      console.log(`   Duration: ${(result.totalDuration / 1000).toFixed(1)}s`);
    } catch (error) {
      console.error('\n❌ Pipeline failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('resume')
  .description('Resume an interrupted Pipeline')
  .requiredOption('-i, --id <pipelineId>', 'Pipeline ID')
  .option('-c, --config <path>', 'Config file path')
  .action(async (opts) => {
    try {
      const pipeline = bootstrap(opts.config);
      const result = await pipeline.resume(opts.id);
      console.log(`\n✅ Pipeline resumed: ${result.changeId}`);
      console.log(`   Total cost: $${result.totalCost.toFixed(2)}`);
    } catch (error) {
      console.error('\n❌ Resume failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('status')
  .description('View all Pipeline statuses')
  .option('-c, --config <path>', 'Config file path')
  .action(async (opts) => {
    try {
      // Load StateStore directly to read status
      const { loadConfig } = await import('./config/config.loader.js');
      const config = loadConfig(opts.config);
      const { JsonStateStore } = await import('./infrastructure/persistence/json-state-store.js');
      const { createLogger } = await import('./infrastructure/observability/pino-logger.js');
      const logger = createLogger(config);
      const store = new JsonStateStore(config, logger);
      const states = await store.list();

      if (states.length === 0) {
        console.log('No active pipelines.');
        return;
      }

      console.log('\nActive Pipelines:');
      console.log('─'.repeat(80));
      for (const state of states) {
        console.log(
          `  ${state.id.slice(0, 8)}...  ${state.metadata.status.padEnd(10)} ` +
            `phase=${state.currentPhase.padEnd(10)} ` +
            `cost=$${state.metadata.totalCost.toFixed(2).padStart(6)} ` +
            `${state.changeId}`,
        );
      }
    } catch (error) {
      console.error('Failed to load status:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program.parse();
