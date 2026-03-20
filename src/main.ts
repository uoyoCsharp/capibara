#!/usr/bin/env node
/**
 * CLI Entry Point - Uses commander to parse command line arguments
 * @module main
 */

import 'reflect-metadata';
import { createRequire } from 'module';
import { Command } from 'commander';
import { bootstrap, bootstrapLight, createPipelineFactory } from './composition-root.js';
import type { InteractionMode } from './core/types/phase.types.js';
import { RequirementOrchestrator } from './application/orchestrator/requirement-orchestrator.js';
import { EmitteryEventBus } from './infrastructure/observability/emittery-event-bus.js';
import { createLogger } from './infrastructure/observability/pino-logger.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as {
  name: string;
  version: string;
  description: string;
  cli_prefix: string;
};

const program = new Command();

program.name(pkg.cli_prefix).description(pkg.description).version(pkg.version);

// ─────────────────────────────────────────────
// Legacy: one-shot run (unchanged)
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// Project management
// ─────────────────────────────────────────────

const projectCmd = program.command('project').description('Manage projects');

projectCmd
  .command('add')
  .description('Add a new project')
  .requiredOption('-n, --name <name>', 'Project name')
  .requiredOption('--dir <path>', 'Project directory (absolute path)')
  .action(async (opts) => {
    const { projectRegistry, sqliteStore } = bootstrapLight();
    try {
      const project = await projectRegistry.add({
        name: opts.name,
        projectDir: opts.dir,
      });
      console.log(`✅ Project added: ${project.name} (${project.id.slice(0, 8)}...)`);
      console.log(`   Directory: ${project.projectDir}`);
    } finally {
      sqliteStore.close();
    }
  });

projectCmd
  .command('list')
  .description('List all projects')
  .action(async () => {
    const { projectRegistry, sqliteStore } = bootstrapLight();
    try {
      const projects = await projectRegistry.list();
      if (projects.length === 0) {
        console.log('No projects registered. Use `cpbr project add` to add one.');
        return;
      }
      console.log('\nProjects:');
      console.log('─'.repeat(80));
      for (const p of projects) {
        const active = p.isActive ? ' [ACTIVE]' : '';
        console.log(`  ${p.id.slice(0, 8)}...  ${p.name.padEnd(20)}  ${p.projectDir}${active}`);
      }
    } finally {
      sqliteStore.close();
    }
  });

projectCmd
  .command('switch')
  .description('Switch active project')
  .argument('<id>', 'Project ID (or prefix)')
  .action(async (idPrefix: string) => {
    const { projectRegistry, sqliteStore } = bootstrapLight();
    try {
      const project = await resolveProjectByPrefix(projectRegistry, idPrefix);
      await projectRegistry.setActive(project.id);
      console.log(`✅ Switched to: ${project.name} (${project.projectDir})`);
    } finally {
      sqliteStore.close();
    }
  });

projectCmd
  .command('remove')
  .description('Remove a project (and its requirements)')
  .argument('<id>', 'Project ID (or prefix)')
  .action(async (idPrefix: string) => {
    const { projectRegistry, sqliteStore } = bootstrapLight();
    try {
      const project = await resolveProjectByPrefix(projectRegistry, idPrefix);
      await projectRegistry.remove(project.id);
      console.log(`✅ Removed project: ${project.name}`);
    } finally {
      sqliteStore.close();
    }
  });

// ─────────────────────────────────────────────
// Requirement pool management
// ─────────────────────────────────────────────

const poolCmd = program.command('pool').description('Manage requirement pool');

poolCmd
  .command('add')
  .description('Add a requirement to the active project pool')
  .requiredOption('-t, --title <title>', 'Requirement title')
  .requiredOption('-d, --description <desc>', 'Requirement description')
  .option('-p, --priority <n>', 'Priority (higher = more urgent)', '0')
  .action(async (opts) => {
    const { projectRegistry, requirementPool, sqliteStore } = bootstrapLight();
    try {
      const project = await requireActiveProject(projectRegistry);
      const req = await requirementPool.add(project.id, {
        title: opts.title,
        description: opts.description,
        priority: parseInt(opts.priority, 10),
      });
      console.log(`✅ Requirement added: ${req.title} (${req.id.slice(0, 8)}...)`);
      console.log(`   Project: ${project.name}`);
      console.log(`   Status: ${req.status}`);
    } finally {
      sqliteStore.close();
    }
  });

poolCmd
  .command('list')
  .description('List requirements for the active project')
  .option('-s, --status <status>', 'Filter by status: pending | in-progress | completed | failed')
  .action(async (opts) => {
    const { projectRegistry, requirementPool, sqliteStore } = bootstrapLight();
    try {
      const project = await requireActiveProject(projectRegistry);
      const reqs = await requirementPool.list(
        project.id,
        opts.status ? { status: opts.status } : undefined,
      );

      if (reqs.length === 0) {
        console.log(
          `No requirements${opts.status ? ` with status "${opts.status}"` : ''} for ${project.name}.`,
        );
        return;
      }

      console.log(`\nRequirements for ${project.name}:`);
      console.log('─'.repeat(80));
      for (const r of reqs) {
        const prio = r.priority ? ` [P${r.priority}]` : '';
        console.log(
          `  ${r.id.slice(0, 8)}...  ${(r.status ?? 'pending').padEnd(12)}  ${r.title}${prio}`,
        );
      }
    } finally {
      sqliteStore.close();
    }
  });

poolCmd
  .command('update')
  .description('Update a requirement')
  .argument('<id>', 'Requirement ID (or prefix)')
  .option('-s, --status <status>', 'New status')
  .option('-t, --title <title>', 'New title')
  .option('-d, --description <desc>', 'New description')
  .option('-p, --priority <n>', 'New priority')
  .action(async (idPrefix: string, opts) => {
    const validStatuses = ['pending', 'in-progress', 'completed', 'failed'];
    if (opts.status && !validStatuses.includes(opts.status)) {
      console.error(`Invalid status: "${opts.status}". Valid values: ${validStatuses.join(', ')}`);
      process.exit(1);
    }

    const { requirementPool, sqliteStore } = bootstrapLight();
    try {
      const req = await resolveRequirementByPrefix(requirementPool, idPrefix);
      const patch: Record<string, unknown> = {};
      if (opts.status) patch.status = opts.status;
      if (opts.title) patch.title = opts.title;
      if (opts.description) patch.description = opts.description;
      if (opts.priority) patch.priority = parseInt(opts.priority, 10);

      const updated = await requirementPool.update(req.id, patch);
      console.log(`✅ Updated: ${updated.title} → status=${updated.status}`);
    } finally {
      sqliteStore.close();
    }
  });

poolCmd
  .command('remove')
  .description('Remove a requirement')
  .argument('<id>', 'Requirement ID (or prefix)')
  .action(async (idPrefix: string) => {
    const { requirementPool, sqliteStore } = bootstrapLight();
    try {
      const req = await resolveRequirementByPrefix(requirementPool, idPrefix);
      await requirementPool.remove(req.id);
      console.log(`✅ Removed: ${req.title}`);
    } finally {
      sqliteStore.close();
    }
  });

// ─────────────────────────────────────────────
// Start: orchestrator (consume loop + standby)
// ─────────────────────────────────────────────

program
  .command('start')
  .description('Start the orchestrator: consume requirements from pool and enter standby')
  .option('-c, --config <path>', 'Config file path')
  .option('--poll-interval <ms>', 'Standby polling interval in ms', '10000')
  .action(async (opts) => {
    try {
      const { config, projectRegistry, requirementPool, sqliteStore } = bootstrapLight(opts.config);
      const logger = createLogger(config);
      const eventBus = new EmitteryEventBus();
      const pipelineFactory = createPipelineFactory();

      const orchestrator = new RequirementOrchestrator(
        requirementPool,
        projectRegistry,
        pipelineFactory,
        config,
        logger,
        eventBus,
        parseInt(opts.pollInterval, 10),
      );

      // Graceful shutdown: stop() waits for current pipeline to finish, then start() resolves
      let stopping = false;
      const shutdown = async () => {
        if (stopping) return;
        stopping = true;
        console.log('\nShutting down (waiting for current pipeline to finish)...');
        await orchestrator.stop();
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

      await orchestrator.start();
      sqliteStore.close();
    } catch (error) {
      console.error('\n❌ Orchestrator failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// ─────────────────────────────────────────────
// Status (unchanged)
// ─────────────────────────────────────────────

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
      const { createLogger: cl } = await import('./infrastructure/observability/pino-logger.js');
      const logger = cl(config);
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

// ─────────────────────────────────────────────
// Resume (unchanged)
// ─────────────────────────────────────────────

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

program.parse();

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

import type { IProjectRegistry } from './core/interfaces/project-registry.interface.js';
import type { IRequirementPool } from './core/interfaces/requirement-pool.interface.js';

async function requireActiveProject(registry: IProjectRegistry) {
  const project = await registry.getActive();
  if (!project) {
    console.error('No active project. Run `cpbr project add` then `cpbr project switch` first.');
    process.exit(1);
  }
  return project;
}

async function resolveProjectByPrefix(registry: IProjectRegistry, prefix: string) {
  const projects = await registry.list();
  const match = projects.find((p) => p.id.startsWith(prefix) || p.name === prefix);
  if (!match) {
    console.error(`Project not found: ${prefix}`);
    process.exit(1);
  }
  return match;
}

async function resolveRequirementByPrefix(pool: IRequirementPool, prefix: string) {
  // Try direct get first
  const direct = await pool.get(prefix);
  if (direct) return direct;

  // No prefix search available — user must provide full ID or we error
  console.error(`Requirement not found: ${prefix}`);
  process.exit(1);
}
