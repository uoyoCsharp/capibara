import { useState, useEffect, useCallback, useMemo } from 'react';
import type { WorkflowSchemaRecord } from '@shared/contracts';

export interface WorkflowSchemaHelpers {
  schema: WorkflowSchemaRecord | null;
  loading: boolean;
  /** Get allowed child types for a parent type, or root types if parentType is null */
  getAllowedTypes: (parentType: string | null) => WorkflowSchemaRecord['workItemTypes'];
  /** Get display label for a type name */
  typeLabel: (name: string) => string;
  /** Get display label for a status name */
  statusLabel: (name: string) => string;
  /** Get manual transitions from a given status */
  getManualTransitions: (from: string) => string[];
  /** Check if a status is terminal */
  isTerminalStatus: (status: string) => boolean;
  /** Check if a status is review */
  isReviewStatus: (status: string) => boolean;
  /** Reload the schema */
  reload: () => Promise<void>;
}

export function useWorkflowSchema(orgId: string | null): WorkflowSchemaHelpers {
  const [schema, setSchema] = useState<WorkflowSchemaRecord | null>(null);
  const [loading, setLoading] = useState(false);

  const loadSchema = useCallback(async () => {
    if (!orgId) {
      setSchema(null);
      return;
    }
    setLoading(true);
    try {
      const result = await window.capibara.getActiveSchema(orgId);
      if (result.ok) {
        setSchema(result.data);
      }
    } catch {
      // Schema may not exist yet for new orgs
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    loadSchema();
  }, [loadSchema]);

  // Listen for schema updates
  useEffect(() => {
    if (!orgId || typeof window.capibara?.subscribe !== 'function') return;
    const unsub = window.capibara.subscribe((event) => {
      if (event.type === 'schema:updated' && 'orgId' in event && event.orgId === orgId) {
        loadSchema();
      }
    });
    return unsub;
  }, [orgId, loadSchema]);

  const getAllowedTypes = useCallback(
    (parentType: string | null) => {
      if (!schema) return [];
      if (parentType === null) {
        return schema.workItemTypes.filter((t) => t.allowedAtRoot);
      }
      const parentDef = schema.workItemTypes.find((t) => t.name === parentType);
      if (!parentDef) return [];
      return schema.workItemTypes.filter((t) => parentDef.allowedChildren.includes(t.name));
    },
    [schema],
  );

  const typeLabel = useCallback(
    (name: string) => {
      if (!schema) return name;
      return schema.workItemTypes.find((t) => t.name === name)?.label ?? name;
    },
    [schema],
  );

  const statusLabel = useCallback(
    (name: string) => {
      if (!schema) return name;
      return schema.statuses.find((s) => s.name === name)?.label ?? name;
    },
    [schema],
  );

  const getManualTransitions = useCallback(
    (from: string) => {
      if (!schema) return [];
      return schema.transitions
        .filter((t) => t.from === from && t.trigger === 'manual')
        .map((t) => t.to);
    },
    [schema],
  );

  const isTerminalStatus = useCallback(
    (status: string) => {
      if (!schema) return false;
      return schema.statuses.find((s) => s.name === status)?.category === 'terminal';
    },
    [schema],
  );

  const isReviewStatus = useCallback(
    (status: string) => {
      if (!schema) return false;
      return schema.statuses.find((s) => s.name === status)?.category === 'review';
    },
    [schema],
  );

  return useMemo(
    () => ({
      schema,
      loading,
      getAllowedTypes,
      typeLabel,
      statusLabel,
      getManualTransitions,
      isTerminalStatus,
      isReviewStatus,
      reload: loadSchema,
    }),
    [schema, loading, getAllowedTypes, typeLabel, statusLabel, getManualTransitions, isTerminalStatus, isReviewStatus, loadSchema],
  );
}
