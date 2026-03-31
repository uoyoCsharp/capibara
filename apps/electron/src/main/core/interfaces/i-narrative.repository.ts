import type { Narrative } from '../types/domain.types.js';

export interface CreateNarrativeInput {
  orgId: string;
  templateData: Record<string, unknown>;
  renderedText: string;
}

export interface INarrativeRepository {
  findById(id: string): Promise<Narrative | null>;
  findLatestByOrgId(orgId: string): Promise<Narrative | null>;
  findByOrgId(orgId: string): Promise<Narrative[]>;
  create(input: CreateNarrativeInput): Promise<Narrative>;
}
