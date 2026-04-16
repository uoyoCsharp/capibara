import { useState, useCallback, useRef } from 'react';
import {
  CaretRight,
  CaretDown,
  Trash,
  PencilSimple,
  Check,
  X,
  TreeStructure,
  CircleNotch,
} from '@phosphor-icons/react';
import type { PlanTaskNode, PendingPlanRecord, SectionId } from '@shared/contracts';
import { cn } from '../../lib/utils';
import { useT } from '../../hooks/useLocale';
import { useCapibaraSnapshot } from '../../hooks/useCapibaraSnapshot';
import { toast } from '../../store/toast.store';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { ConfirmDialog } from '../shared/ConfirmDialog';

declare const window: Window & { capibara: import('@shared/contracts').CapibaraApi };

/** Rotating color palette for type badges (same as TaskTreeView) */
const TYPE_COLOR_PALETTE = [
  'bg-purple-100 text-purple-700',
  'bg-blue-100 text-blue-700',
  'bg-primary/10 text-primary',
  'bg-yellow-500/10 text-yellow-600',
  'bg-green-100 text-green-700',
  'bg-orange-100 text-orange-700',
  'bg-pink-100 text-pink-700',
  'bg-cyan-100 text-cyan-700',
];

function getTypeColor(type: string): string {
  let hash = 0;
  for (let i = 0; i < type.length; i++) {
    hash = ((hash << 5) - hash + type.charCodeAt(i)) | 0;
  }
  return TYPE_COLOR_PALETTE[Math.abs(hash) % TYPE_COLOR_PALETTE.length];
}

interface PlanPreviewProps {
  plan: PendingPlanRecord;
  onPlanChange: (plan: PendingPlanRecord) => void;
  onConfirm: () => void;
  onStartOver: () => void;
  onRefinePlan: () => void;
  onNavigate?: (section: SectionId) => void;
}

/** Count tasks by type in a tree */
function countByType(nodes: PlanTaskNode[]): Map<string, number> {
  const counts = new Map<string, number>();
  const walk = (list: PlanTaskNode[]) => {
    for (const n of list) {
      counts.set(n.type, (counts.get(n.type) ?? 0) + 1);
      walk(n.children);
    }
  };
  walk(nodes);
  return counts;
}

/** Count total nodes */
function countTotal(nodes: PlanTaskNode[]): number {
  return nodes.reduce((sum, n) => sum + 1 + countTotal(n.children), 0);
}

export function PlanPreview({ plan, onPlanChange, onConfirm, onStartOver, onRefinePlan, onNavigate }: PlanPreviewProps) {
  const t = useT();
  const { currentOrgId } = useCapibaraSnapshot();
  const [isCreating, setIsCreating] = useState(false);
  const creatingRef = useRef(false);
  const [showStartOverDialog, setShowStartOverDialog] = useState(false);

  const totalCount = countTotal(plan.tasks);
  const typeCounts = countByType(plan.tasks);
  const typeCountStr = [...typeCounts.entries()]
    .map(([type, count]) => `${count} ${type}${count > 1 ? 's' : ''}`)
    .join(', ');

  // ── Update a node's title ─────────────────────────────────
  const handleTitleChange = useCallback((path: number[], newTitle: string) => {
    const newTasks = structuredClone(plan.tasks);
    let target: PlanTaskNode[] = newTasks;
    for (let i = 0; i < path.length - 1; i++) {
      target = target[path[i]].children;
    }
    target[path[path.length - 1]].title = newTitle;
    onPlanChange({ ...plan, tasks: newTasks });
  }, [plan, onPlanChange]);

  // ── Delete a node ─────────────────────────────────────────
  const handleDelete = useCallback((path: number[]) => {
    const newTasks = structuredClone(plan.tasks);
    let target: PlanTaskNode[] = newTasks;
    for (let i = 0; i < path.length - 1; i++) {
      target = target[path[i]].children;
    }
    target.splice(path[path.length - 1], 1);
    onPlanChange({ ...plan, tasks: newTasks });
  }, [plan, onPlanChange]);

  // ── Confirm create ────────────────────────────────────────
  const handleCreate = async () => {
    if (!currentOrgId || plan.tasks.length === 0 || creatingRef.current) return;
    creatingRef.current = true;
    setIsCreating(true);
    try {
      const res = await window.capibara.batchCreateTasks({ orgId: currentOrgId, plan });
      if (res.ok) {
        toast.success(`${t.planning.tasksCreated} (${res.data.createdCount})`);
        onNavigate?.('tasks');
      } else {
        toast.error(`${t.planning.failedToCreateTasks}: ${res.error.message}`);
      }
    } catch {
      toast.error(t.planning.failedToCreateTasks);
    } finally {
      creatingRef.current = false;
      setIsCreating(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b px-6 py-4">
        <div className="flex items-center gap-2 mb-1">
          <TreeStructure size={20} className="text-primary" />
          <h1 className="text-lg font-semibold text-foreground">{t.planning.planReady}</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-2">{plan.summary}</p>
        <p className="text-xs text-muted-foreground">
          {totalCount} {t.common.total} ({typeCountStr})
        </p>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-auto px-6 py-4">
        <div className="max-w-3xl mx-auto space-y-1">
          {plan.tasks.map((node, idx) => (
            <PlanTreeNode
              key={`root-${idx}`}
              node={node}
              path={[idx]}
              onTitleChange={handleTitleChange}
              onDelete={handleDelete}
            />
          ))}
          {plan.tasks.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              All tasks have been removed. Start over to create a new plan.
            </p>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="border-t px-6 py-3">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <Button
            variant="outline"
            onClick={() => setShowStartOverDialog(true)}
          >
            {t.planning.startOver}
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={onRefinePlan}
            >
              {t.planning.refinePlan}
            </Button>
            <Button
              onClick={handleCreate}
              disabled={isCreating || plan.tasks.length === 0}
            >
              {isCreating ? (
                <>
                  <CircleNotch size={14} className="animate-spin mr-1" />
                  {t.planning.creatingTasks}
                </>
              ) : (
                t.planning.createAllTasks
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Start Over dialog */}
      {showStartOverDialog && (
        <ConfirmDialog
          title={t.planning.startOverConfirm}
          message={t.planning.startOverConfirmMessage}
          confirmLabel={t.common.confirm}
          cancelLabel={t.common.cancel}
          variant="warning"
          onConfirm={() => { setShowStartOverDialog(false); onStartOver(); }}
          onCancel={() => setShowStartOverDialog(false)}
        />
      )}
    </div>
  );
}

// ── Tree Node Component ─────────────────────────────────────

interface PlanTreeNodeProps {
  node: PlanTaskNode;
  path: number[];
  onTitleChange: (path: number[], newTitle: string) => void;
  onDelete: (path: number[]) => void;
  depth?: number;
}

function PlanTreeNode({ node, path, onTitleChange, onDelete, depth = 0 }: PlanTreeNodeProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(node.title);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const hasChildren = node.children.length > 0;
  const childCount = countTotal(node.children);

  const handleSave = () => {
    const trimmed = editValue.trim();
    if (!trimmed) {
      // Revert to original title if empty
      setEditValue(node.title);
      setIsEditing(false);
      return;
    }
    if (trimmed !== node.title) {
      onTitleChange(path, trimmed);
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditValue(node.title);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); handleSave(); }
    if (e.key === 'Escape') { handleCancel(); }
  };

  return (
    <div style={{ marginLeft: depth * 20 }}>
      <div className="group flex items-center gap-1.5 rounded-md px-2 py-1.5 hover:bg-muted/50 transition-colors">
        {/* Expand/collapse toggle */}
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className={cn('shrink-0 w-5 h-5 flex items-center justify-center', !hasChildren && 'invisible')}
        >
          {expanded ? <CaretDown size={14} /> : <CaretRight size={14} />}
        </button>

        {/* Type badge */}
        <Badge
          variant="outline"
          className={cn('shrink-0 text-[10px] px-1.5 py-0 border-0', getTypeColor(node.type))}
        >
          {node.type}
        </Badge>

        {/* Title (editable) */}
        {isEditing ? (
          <div className="flex-1 flex items-center gap-1">
            <input
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleSave}
              autoFocus
              className="flex-1 text-sm bg-transparent border-b border-primary outline-none py-0.5"
            />
            <button type="button" onMouseDown={(e) => { e.preventDefault(); handleSave(); }} className="text-primary hover:text-primary/80">
              <Check size={14} />
            </button>
            <button type="button" onMouseDown={(e) => { e.preventDefault(); handleCancel(); }} className="text-muted-foreground hover:text-foreground">
              <X size={14} />
            </button>
          </div>
        ) : (
          <span
            className="flex-1 text-sm text-foreground truncate cursor-pointer hover:underline"
            onClick={() => { setEditValue(node.title); setIsEditing(true); }}
            title={node.title}
          >
            {node.title}
          </span>
        )}

        {/* Role name */}
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {node.assigneeRoleName ?? t.common.unassigned}
        </span>

        {/* Actions (visible on hover) */}
        <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={() => { setEditValue(node.title); setIsEditing(true); }}
            className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
            title={t.common.edit}
          >
            <PencilSimple size={12} />
          </button>
          <button
            type="button"
            onClick={() => setShowDeleteDialog(true)}
            className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
            title={t.common.delete}
          >
            <Trash size={12} />
          </button>
        </div>
      </div>

      {/* Children */}
      {expanded && hasChildren && (
        <div>
          {node.children.map((child, idx) => (
            <PlanTreeNode
              key={`${path.join('-')}-${idx}`}
              node={child}
              path={[...path, idx]}
              onTitleChange={onTitleChange}
              onDelete={onDelete}
              depth={depth + 1}
            />
          ))}
        </div>
      )}

      {/* Delete confirmation */}
      {showDeleteDialog && (
        <ConfirmDialog
          title={t.common.delete}
          message={`Delete "${node.title}"${childCount > 0 ? ` and ${childCount} child task${childCount > 1 ? 's' : ''}` : ''}?`}
          confirmLabel={t.common.delete}
          cancelLabel={t.common.cancel}
          variant="danger"
          onConfirm={() => { setShowDeleteDialog(false); onDelete(path); }}
          onCancel={() => setShowDeleteDialog(false)}
        />
      )}
    </div>
  );
}
