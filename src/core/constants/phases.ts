/**
 * Phase constants
 * @module core/constants/phases
 */

import type { Phase } from '../types/phase.types.js';

/**
 * Default development phases
 * Note: Actual phases are provided by the prompt framework via getSupportedPhases()
 * This constant serves as a fallback/default for configuration validation
 */
export const PHASES: Phase[] = ['analyze', 'design', 'implement', 'review', 'test'];
