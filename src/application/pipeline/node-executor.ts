/**
 * Node Executor - Dispatches node execution to type-specific handlers
 *
 * Thin dispatcher: maps PipelineNodeType to INodeHandler and delegates.
 * @module application/pipeline/node-executor
 */

import type { PipelineNodeType, PipelineNodeDefinition } from '../../core/types/dag.types.js';
import type { PipelineContext, PhaseResult } from '../../core/types/pipeline.types.js';
import type { GenericStateMachine } from '../state-machine/generic-state-machine.js';
import type { INodeHandler } from './node-handler.js';

export class NodeExecutor {
  private handlers: Map<PipelineNodeType, INodeHandler>;

  constructor(handlers: INodeHandler[]) {
    this.handlers = new Map(handlers.map((h) => [h.nodeType, h]));
  }

  async execute(
    node: PipelineNodeDefinition,
    context: PipelineContext,
    stateMachine: GenericStateMachine,
  ): Promise<PhaseResult> {
    const handler = this.handlers.get(node.type);
    if (!handler) {
      throw new Error(
        `No handler registered for node type: "${node.type}". ` +
        `Registered types: ${[...this.handlers.keys()].join(', ')}`,
      );
    }
    return handler.handle(node, context, stateMachine);
  }
}
