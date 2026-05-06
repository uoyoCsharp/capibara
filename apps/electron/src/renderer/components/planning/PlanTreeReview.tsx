import { useEffect, useMemo, useState } from 'react';
import { CaretDown, CaretRight, Check, Trash, ChatCircle, CircleNotch } from '@phosphor-icons/react';
import type { PlanDraftNodeRecord, PendingTreeRecord, RoleRecord } from '@core/shared/types';
import { usePlanTreeStore } from '../../store/plan-tree.store';
import { useT } from '../../hooks/use-locale';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Badge } from '../ui/badge';
import { Separator } from '../ui/separator';

function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

const COLLAPSE_THRESHOLD = 100;

interface PlanTreeReviewProps {
  pending: PendingTreeRecord;
  roles: RoleRecord[];
  typeLabel: (name: string) => string;
  onClose?: () => void;
}

function countNodes(node: PlanDraftNodeRecord): number {
  let c = 1;
  for (const child of node.children) c += countNodes(child);
  return c;
}

function measureDepth(node: PlanDraftNodeRecord, d = 1): number {
  if (node.children.length === 0) return d;
  return Math.max(...node.children.map((c) => measureDepth(c, d + 1)));
}

function tallyAssignees(node: PlanDraftNodeRecord, acc: Record<string, number>): void {
  acc[node.assigneeRoleId] = (acc[node.assigneeRoleId] ?? 0) + 1;
  for (const child of node.children) tallyAssignees(child, acc);
}

export function PlanTreeReview({ pending, roles, typeLabel, onClose }: PlanTreeReviewProps) {
  const t = useT();
  const approve = usePlanTreeStore((s) => s.approve);
  const discard = usePlanTreeStore((s) => s.discard);
  const refine = usePlanTreeStore((s) => s.refine);
  // This component is used only for the task-anchored review flow.
  // Conversation-anchored planning has its own UI (PlanningPage in Slice 3).
  const rootTaskId = pending.rootTaskId!;
  const refining = usePlanTreeStore((s) => s.refining[rootTaskId] ?? false);
  const lastError = usePlanTreeStore((s) => s.lastError[rootTaskId] ?? null);

  const [showDiscardForm, setShowDiscardForm] = useState(false);
  const [discardReason, setDiscardReason] = useState('');
  const [showRefineForm, setShowRefineForm] = useState(false);
  const [refineFeedback, setRefineFeedback] = useState('');
  const [busy, setBusy] = useState(false);

  const nodeCount = useMemo(() => countNodes(pending.tree), [pending.tree]);
  const maxDepth = useMemo(() => measureDepth(pending.tree), [pending.tree]);
  const roleMap = useMemo(() => new Map(roles.map((r) => [r.id, r.name])), [roles]);
  const assigneeTally = useMemo(() => {
    const acc: Record<string, number> = {};
    tallyAssignees(pending.tree, acc);
    return acc;
  }, [pending.tree]);

  const defaultCollapsed = nodeCount > COLLAPSE_THRESHOLD;

  useEffect(() => {
    setShowDiscardForm(false);
    setDiscardReason('');
    setShowRefineForm(false);
    setRefineFeedback('');
  }, [pending.version]);

  const handleApprove = async () => {
    setBusy(true);
    const ok = await approve(rootTaskId);
    setBusy(false);
    if (ok) onClose?.();
  };

  const handleDiscard = async () => {
    setBusy(true);
    const ok = await discard(rootTaskId, discardReason.trim() || undefined);
    setBusy(false);
    if (ok) onClose?.();
  };

  const handleRefine = async () => {
    if (!refineFeedback.trim()) return;
    const ok = await refine(rootTaskId, refineFeedback.trim());
    if (ok) {
      setShowRefineForm(false);
      setRefineFeedback('');
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-start justify-between border-b px-4 py-3">
        <div>
          <h2 className="text-base font-semibold">{t.planTreeReview.title}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {pending.mode === 'preview' ? t.planTreeReview.previewModeHint : t.planTreeReview.eagerModeHint}
            &nbsp;·&nbsp;{interpolate(t.planPreview.summaryVersion, { n: pending.version })}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{interpolate(t.planTreeReview.nodes, { count: nodeCount })}</span>
          <span>·</span>
          <span>{interpolate(t.planTreeReview.depth, { n: maxDepth })}</span>
        </div>
      </div>

      {/* Summary */}
      <div className="border-b px-4 py-3 space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t.planTreeReview.roleDistribution}</p>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(assigneeTally).map(([roleId, count]) => (
            <Badge key={roleId} variant="secondary" className="text-xs">
              {roleMap.get(roleId) ?? roleId} · {count}
            </Badge>
          ))}
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-auto px-4 py-3">
        <PlanDraftNode
          node={pending.tree}
          depth={0}
          typeLabel={typeLabel}
          roleMap={roleMap}
          defaultCollapsed={defaultCollapsed}
        />
      </div>

      {/* Error */}
      {lastError && (
        <div className="border-t border-destructive/40 bg-destructive/5 px-4 py-2 text-xs text-destructive">
          {lastError}
        </div>
      )}

      {/* Refine form */}
      {showRefineForm && (
        <div className="border-t px-4 py-3 space-y-2 bg-muted/20">
          <p className="text-xs font-medium">{t.planTreeReview.refineTitle}</p>
          <Textarea
            value={refineFeedback}
            onChange={(e) => setRefineFeedback(e.target.value)}
            placeholder={t.planTreeReview.refinePlaceholder}
            rows={3}
            disabled={refining}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setShowRefineForm(false)} disabled={refining}>
              {t.planTreeReview.refineClose}
            </Button>
            <Button
              size="sm"
              onClick={handleRefine}
              disabled={refining || !refineFeedback.trim()}
            >
              {refining ? (
                <><CircleNotch size={14} className="mr-1.5 animate-spin" />{t.planTreeReview.refineWaiting}</>
              ) : (
                t.planTreeReview.refineSend
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Discard form */}
      {showDiscardForm && (
        <div className="border-t px-4 py-3 space-y-2 bg-muted/20">
          <p className="text-xs font-medium">{t.planTreeReview.discardReason}</p>
          <Textarea
            value={discardReason}
            onChange={(e) => setDiscardReason(e.target.value)}
            rows={2}
            disabled={busy}
            placeholder={t.planTreeReview.discardPlaceholder}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setShowDiscardForm(false)} disabled={busy}>
              {t.planTreeReview.cancelBtn}
            </Button>
            <Button variant="destructive" size="sm" onClick={handleDiscard} disabled={busy}>
              {t.planTreeReview.discardPlan}
            </Button>
          </div>
        </div>
      )}

      <Separator />

      {/* Actions */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setShowRefineForm((v) => !v); setShowDiscardForm(false); }}
            disabled={busy || refining}
          >
            <ChatCircle size={14} className="mr-1.5" />
            {t.planTreeReview.refineBtn}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setShowDiscardForm((v) => !v); setShowRefineForm(false); }}
            disabled={busy || refining}
            className="text-destructive hover:text-destructive"
          >
            <Trash size={14} className="mr-1.5" />
            {t.planTreeReview.discardBtn}
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {onClose && (
            <Button variant="outline" size="sm" onClick={onClose} disabled={busy || refining}>
              {t.planTreeReview.closeBtn}
            </Button>
          )}
          <Button onClick={handleApprove} size="sm" disabled={busy || refining}>
            {busy ? (
              <><CircleNotch size={14} className="mr-1.5 animate-spin" />{t.planTreeReview.approveCommitting}</>
            ) : (
              <><Check size={14} className="mr-1.5" />{t.planTreeReview.approveBtn}</>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function PlanDraftNode({
  node,
  depth,
  typeLabel,
  roleMap,
  defaultCollapsed,
}: {
  node: PlanDraftNodeRecord;
  depth: number;
  typeLabel: (name: string) => string;
  roleMap: Map<string, string>;
  defaultCollapsed: boolean;
}) {
  const [expanded, setExpanded] = useState<boolean>(() => {
    if (!defaultCollapsed) return true;
    return depth < 1;
  });

  const hasChildren = node.children.length > 0;
  const assigneeName = roleMap.get(node.assigneeRoleId) ?? node.assigneeRoleId;

  return (
    <div className={cn('py-1', depth > 0 && 'border-l pl-3 ml-2')}>
      <div className="flex items-start gap-1.5">
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-0.5 text-muted-foreground hover:text-foreground"
          >
            {expanded ? <CaretDown size={14} /> : <CaretRight size={14} />}
          </button>
        ) : (
          <span className="w-[14px] shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
              {typeLabel(node.type)}
            </Badge>
            <span className="text-sm font-medium truncate">{node.title}</span>
            <Badge variant="secondary" className="text-[10px]">@ {assigneeName}</Badge>
            {hasChildren && (
              <span className="text-[10px] text-muted-foreground">{node.children.length} child{node.children.length === 1 ? '' : 'ren'}</span>
            )}
          </div>
          {node.description && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{node.description}</p>
          )}
        </div>
      </div>
      {expanded && hasChildren && (
        <div className="mt-1">
          {node.children.map((child, i) => (
            <PlanDraftNode
              key={i}
              node={child}
              depth={depth + 1}
              typeLabel={typeLabel}
              roleMap={roleMap}
              defaultCollapsed={defaultCollapsed}
            />
          ))}
        </div>
      )}
    </div>
  );
}
