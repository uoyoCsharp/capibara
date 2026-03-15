/**
 * Application error base class - All custom errors inherit from this class
 * @module core/errors/base
 */

export class AppError extends Error {
  constructor(
    message: string,
    /** Error code for logging and categorization */
    public readonly code: string,
    /** Whether automatically recoverable (retry/fallback) */
    public readonly recoverable: boolean = false,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}
