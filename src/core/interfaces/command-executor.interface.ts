/**
 * Universal Command Executor Interface
 *
 * Shared by all role implementations as the underlying execution abstraction.
 * Encapsulates "how to execute commands" so that role implementations
 * (implementations/) only focus on "what commands to assemble".
 *
 * Lifecycle: registered at startup via DI, config changes require restart.
 * @module core/interfaces/command-executor
 */

import type {
  CommandRequest,
  CommandResponse,
} from '../types/command-executor.types.js';

export interface ICommandExecutor {
  /** Executor type identifier */
  readonly type: string;

  /** Execute command and return unified response */
  execute(request: CommandRequest): Promise<CommandResponse>;

  /** Validate executor configuration (called at startup) */
  validate(): Promise<boolean>;
}
