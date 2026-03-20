/**
 * Default Pipeline Factory
 *
 * Generates a default linear DAG definition when no custom definition file is configured.
 * The default pipeline mirrors the original linear phase array behavior:
 * analyze -> design -> implement -> review -> test
 * Each phase is a worker node followed sequentially.
 * @module infrastructure/pipeline/default-pipeline-factory
 */

import type { PipelineDefinition, PipelineNodeDefinition, PipelineEdgeDefinition } from '../../core/types/dag.types.js';
import type { Phase } from '../../core/types/phase.types.js';

const DEFAULT_PHASES: Phase[] = ['analyze', 'design', 'implement', 'review', 'test'];

export function createDefaultPipelineDefinition(
  phases: Phase[] = DEFAULT_PHASES,
): PipelineDefinition {
  const nodes: PipelineNodeDefinition[] = phases.map((phase) => ({
    id: `node-${phase}`,
    type: 'worker' as const,
    name: `${phase} phase`,
    phase,
    config: {},
  }));

  const edges: PipelineEdgeDefinition[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({ from: nodes[i].id, to: nodes[i + 1].id });
  }

  return {
    id: 'default-linear',
    name: 'Default Linear Pipeline',
    description: 'Auto-generated linear pipeline from phase list',
    nodes,
    edges,
    settings: {
      defaultExecutorType: 'claude-cli',
    },
  };
}
