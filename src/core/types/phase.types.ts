/**
 * Development lifecycle phases and interaction mode definitions
 * @module core/types/phase
 */

/** Development lifecycle phases - can be extended by prompt frameworks */
export type Phase = string;

/** Interaction mode */
export type InteractionMode = 'auto' | 'semi-auto' | 'manual';
