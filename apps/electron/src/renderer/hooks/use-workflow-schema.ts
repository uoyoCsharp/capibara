import { useState, useEffect, useCallback } from 'react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = () => window.capibara as any;

interface WorkItemType {
  name: string;
  label: string;
  isLeaf: boolean;
  allowedChildren: string[];
  allowedAtRoot: boolean;
}

interface StatusDef {
  name: string;
  label: string;
  category: string;
}

interface TransitionDef {
  from: string;
  to: string;
  mode?: string;
  trigger?: string;
}

interface ProcessSchema {
  workItemTypes: WorkItemType[];
  statuses: StatusDef[];
  transitions: TransitionDef[];
}

export function useWorkflowSchema(orgId: string | null) {
  const [schema, setSchema] = useState<ProcessSchema | null>(null);

  useEffect(() => {
    if (!orgId) return;
    api().getProcessSchema(orgId).then((result: { ok: boolean; data?: unknown }) => {
      if (result.ok && result.data) {
        setSchema(result.data as ProcessSchema);
      }
    });
  }, [orgId]);

  const getAllowedTypes = useCallback((parentType: string | null): WorkItemType[] => {
    if (!schema) return [];
    if (!parentType) return schema.workItemTypes.filter((t) => t.allowedAtRoot);
    const parent = schema.workItemTypes.find((t) => t.name === parentType);
    if (!parent) return [];
    return schema.workItemTypes.filter((t) => parent.allowedChildren.includes(t.name));
  }, [schema]);

  const typeLabel = useCallback((name: string): string => {
    return schema?.workItemTypes.find((t) => t.name === name)?.label ?? name;
  }, [schema]);

  const statusLabel = useCallback((name: string): string => {
    return schema?.statuses.find((s) => s.name === name)?.label ?? name;
  }, [schema]);

  const isTerminalStatus = useCallback((name: string): boolean => {
    return schema?.statuses.find((s) => s.name === name)?.category === 'terminal';
  }, [schema]);

  const isApprovalStatus = useCallback((name: string): boolean => {
    return schema?.statuses.find((s) => s.name === name)?.category === 'approval';
  }, [schema]);

  const getAvailableTransitions = useCallback((fromStatus: string): string[] => {
    if (!schema) return [];
    return schema.transitions
      .filter((t) => t.from === fromStatus && (t.mode === 'manual' || t.trigger === 'manual'))
      .map((t) => t.to);
  }, [schema]);

  return { schema, getAllowedTypes, typeLabel, statusLabel, isTerminalStatus, isApprovalStatus, getAvailableTransitions };
}
