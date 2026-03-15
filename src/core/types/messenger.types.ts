/**
 * Messenger role format and pattern definitions
 * @module core/types/messenger
 */

export type SummaryStyle = 'evaluation-ready' | 'context-recovery' | 'feedback-synthesis';

export interface SummaryFormat {
  style: SummaryStyle;
  template: string;
  maxLength?: number;
}

export interface OutputSchema {
  type: string;
  properties: Record<string, unknown>;
  required?: string[];
}

export type StructuredData = Record<string, unknown>;
