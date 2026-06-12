import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  CaretDown,
  CaretRight,
  Check,
  Trash,
  ChatCircle,
  CircleNotch,
  Sparkle,
  NoteBlank,
  Note,
  Link,
} from '@phosphor-icons/react';
import type {
  PlanDraftNodeRecord,
  PendingTreeRecord,
  RoleRecord,
  DesktopEvent,
} from '@core/shared/types';
import { useEventSubscription } from '../../hooks/use-event-subscription';
import { useT } from '../../hooks/use-locale';
import type { LocaleMessages } from '@shared/locale/types';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Badge } from '../ui/badge';
import { Separator } from '../ui/separator';
import { toast } from '../../store/toast.store';

function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

const api = () => window.capibara;
const COLLAPSE_THRESHOLD = 100;

interface PlanPreviewPaneProps {
  conversationId: string;
  roles: RoleRecord[];
  typeLabel: (name: string) => string;
  /** Called after a successful approve — typically navigates to Tasks. */
  onApproved: () => void;
  /** Called whenever the pane discovers whether a pending tree exists. The
   *  parent uses this to resize the layout (slim sidebar when empty, wide
   *  pane when a tree is present). */
  onHasTreeChange?: (hasTree: boolean) => void;
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

function tallyTypes(node: PlanDraftNodeRecord, acc: Record<string, number>): void {
  acc[node.type] = (acc[node.type] ?? 0) + 1;
  for (const child of node.children) tallyTypes(child, acc);
}

export function PlanPreviewPane({ conversationId, roles, typeLabel, onApproved, onHasTreeChange }: PlanPreviewPaneProps) {
  const t = useT();
  const [pending, setPending] = useState<PendingTreeRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<'approve' | 'discard' | 'refine' | null>(null);
  const [showRefine, setShowRefine] = useState(false);
  const [refineText, setRefineText] = useState('');

  const loadPending = useCallback(async () => {
    setLoading(true);
    const res = await api().getPlanTreeByConversation(conversationId);
    setLoading(false);
    if (res.ok) setPending(res.data as PendingTreeRecord | null);
  }, [conversationId]);

  useEffect(() => { void loadPending(); }, [loadPending]);

  // Propagate tree-presence to parent for layout adjustments.
  useEffect(() => {
    onHasTreeChange?.(pending !== null);
  }, [pending, onHasTreeChange]);

  // Reload on any relevant event, but only if it targets this conversation.
  const planEventTypes = useMemo<DesktopEvent['type'][]>(
    () => ['plan-tree:ready', 'plan-tree:approved', 'plan-tree:discarded'],
    [],
  );
  useEventSubscription(planEventTypes, useCallback((event) => {
    if ('sourceConversationId' in event && event.sourceConversationId === conversationId) {
      void loadPending();
    }
  }, [conversationId, loadPending]));

  const handleApprove = async () => {
    if (!pending) return;
    setBusy('approve');
    const res = await api().approvePlanTreeByConversation(conversationId, pending.version);
    setBusy(null);
    if (res.ok) {
      toast.success(t.planPreview.toastApproved);
      onApproved();
    } else {
      toast.error(res.error?.message ?? t.planPreview.errorApprove);
    }
  };

  const handleDiscard = async () => {
    setBusy('discard');
    const res = await api().discardPlanTreeByConversation(conversationId, 'user_discard');
    setBusy(null);
    if (res.ok) {
      setPending(null);
      toast.info(t.planPreview.toastDiscarded);
    } else {
      toast.error(res.error?.message ?? t.planPreview.errorDiscard);
    }
  };

  const handleRefine = async () => {
    const trimmed = refineText.trim();
    if (!trimmed) return;
    setBusy('refine');
    const res = await api().refinePlanTreeByConversation(conversationId, trimmed);
    setBusy(null);
    if (res.ok) {
      setShowRefine(false);
      setRefineText('');
      toast.info(t.planPreview.toastRefineSent);
    } else {
      toast.error(res.error?.message ?? t.planPreview.errorRefine);
    }
  };

  if (loading && !pending) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        <CircleNotch size={16} className="animate-spin mr-2" />
        {t.planPreview.loading}
      </div>
    );
  }

  if (!pending) {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-muted-foreground">{t.planPreview.title}</h2>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-center px-4 gap-2.5">
          <Sparkle size={28} weight="duotone" className="text-muted-foreground/50" />
          <p className="text-xs font-medium text-muted-foreground">{t.planPreview.waitingTitle}</p>
          <p className="text-[11px] text-muted-foreground/70 leading-relaxed max-w-[200px]">
            {t.planPreview.waitingDescription}
          </p>
        </div>
      </div>
    );
  }

  return <PlanPreview
    t={t}
    pending={pending}
    roles={roles}
    typeLabel={typeLabel}
    busy={busy}
    showRefine={showRefine}
    refineText={refineText}
    onShowRefineChange={setShowRefine}
    onRefineTextChange={setRefineText}
    onApprove={handleApprove}
    onDiscard={handleDiscard}
    onRefine={handleRefine}
  />;
}

interface PlanPreviewProps {
  t: LocaleMessages;
  pending: PendingTreeRecord;
  roles: RoleRecord[];
  typeLabel: (name: string) => string;
  busy: 'approve' | 'discard' | 'refine' | null;
  showRefine: boolean;
  refineText: string;
  onShowRefineChange: (v: boolean) => void;
  onRefineTextChange: (v: string) => void;
  onApprove: () => void;
  onDiscard: () => void;
  onRefine: () => void;
}

function PlanPreview({
  t,
  pending,
  roles,
  typeLabel,
  busy,
  showRefine,
  refineText,
  onShowRefineChange,
  onRefineTextChange,
  onApprove,
  onDiscard,
  onRefine,
}: PlanPreviewProps) {
  const nodeCount = useMemo(() => countNodes(pending.tree), [pending.tree]);
  const maxDepth = useMemo(() => measureDepth(pending.tree), [pending.tree]);
  const roleMap = useMemo(() => new Map(roles.map((r) => [r.id, r.name])), [roles]);
  const typeTally = useMemo(() => {
    const acc: Record<string, number> = {};
    tallyTypes(pending.tree, acc);
    return acc;
  }, [pending.tree]);

  const defaultCollapsed = nodeCount > COLLAPSE_THRESHOLD;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between border-b border-border px-5 py-4">
        <div className="space-y-1">
          <h2 className="text-base font-semibold tracking-tight">{t.planPreview.title}</h2>
          <p className="text-[11px] text-muted-foreground/80 flex items-center gap-1.5">
            <span>{interpolate(t.planPreview.summaryVersion, { n: pending.version })}</span>
            <span className="text-muted-foreground/40">·</span>
            <span>{interpolate(t.planPreview.summaryNodes, { count: nodeCount })}</span>
            <span className="text-muted-foreground/40">·</span>
            <span>{interpolate(t.planPreview.summaryDepth, { n: maxDepth })}</span>
          </p>
        </div>
      </div>

      <div className="border-b border-border px-5 py-3 space-y-2">
        <p className="text-[10px] font-semibold text-muted-foreground/80 uppercase tracking-wider">
          {t.planPreview.summaryByType}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(typeTally).map(([tk, count]) => (
            <Badge key={tk} variant="secondary" className="text-[11px] font-normal">
              {typeLabel(tk)} · {count}
            </Badge>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 py-3">
        <PlanDraftNode
          node={pending.tree}
          depth={0}
          typeLabel={typeLabel}
          roleMap={roleMap}
          defaultCollapsed={defaultCollapsed}
        />
      </div>

      {showRefine && (
        <div className="border-t border-border px-4 py-3 space-y-2 bg-muted/20">
          <p className="text-xs font-medium">{t.planPreview.refineTitle}</p>
          <Textarea
            value={refineText}
            onChange={(e) => onRefineTextChange(e.target.value)}
            placeholder={t.planPreview.refinePlaceholder}
            rows={3}
            disabled={busy === 'refine'}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => onShowRefineChange(false)} disabled={busy === 'refine'}>
              {t.planPreview.refineClose}
            </Button>
            <Button size="sm" onClick={onRefine} disabled={busy === 'refine' || !refineText.trim()}>
              {busy === 'refine' ? (
                <><CircleNotch size={14} className="mr-1.5 animate-spin" />{t.planPreview.refineSending}</>
              ) : (
                t.planPreview.refineSend
              )}
            </Button>
          </div>
        </div>
      )}

      <Separator />

      <div className="flex items-center justify-between px-4 py-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onShowRefineChange(!showRefine)}
          disabled={busy !== null}
        >
          <ChatCircle size={14} className="mr-1.5" />
          {t.planPreview.refine}
        </Button>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onDiscard}
            disabled={busy !== null}
            className="text-destructive hover:text-destructive border-destructive/30 hover:bg-destructive/10"
          >
            <Trash size={14} className="mr-1.5" />
            {busy === 'discard' ? t.planPreview.discarding : t.planPreview.discardBtn}
          </Button>
          <Button onClick={onApprove} size="sm" disabled={busy !== null}>
            {busy === 'approve' ? (
              <><CircleNotch size={14} className="mr-1.5 animate-spin" />{t.planPreview.approving}</>
            ) : (
              <><Check size={14} className="mr-1.5" />{t.planPreview.approve}</>
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
  const [expanded, setExpanded] = useState<boolean>(() => !defaultCollapsed || depth < 1);
  const [showDescription, setShowDescription] = useState(false);
  const hasChildren = node.children.length > 0;
  const hasDescription = Boolean(node.description?.trim());
  const assigneeName = roleMap.get(node.assigneeRoleId) ?? node.assigneeRoleId;

  return (
    <div
      className={cn(
        'py-1.5',
        depth > 0 && 'border-l border-border/60 pl-3 ml-2',
      )}
    >
      <div
        className={cn(
          'group flex items-start gap-1.5 rounded-md px-1.5 py-1 transition-colors',
          'hover:bg-muted/40',
        )}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-1 text-muted-foreground/70 hover:text-foreground transition-colors"
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? <CaretDown size={14} /> : <CaretRight size={14} />}
          </button>
        ) : (
          <span className="w-[14px] shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge
              variant="outline"
              className="text-[10px] uppercase tracking-wider font-semibold border-border/70 text-muted-foreground"
            >
              {typeLabel(node.type)}
            </Badge>
            <span className="text-sm font-medium text-foreground truncate">{node.title}</span>
            <Badge
              variant="secondary"
              className="text-[10px] font-normal text-muted-foreground"
            >
              @ {assigneeName}
            </Badge>
            {hasChildren && (
              <span className="text-[10px] text-muted-foreground/70">
                {node.children.length} child{node.children.length === 1 ? '' : 'ren'}
              </span>
            )}
            {node.dependsOn && node.dependsOn.length > 0 && (
              <Badge variant="outline" className="text-[10px] gap-1 border-orange-500/30 text-orange-600 bg-orange-500/10">
                <Link size={10} weight="bold" />
                {node.dependsOn.length} dep{node.dependsOn.length === 1 ? '' : 's'}
              </Badge>
            )}
            {hasDescription && (
              <button
                type="button"
                onClick={() => setShowDescription((v) => !v)}
                className={cn(
                  'inline-flex items-center justify-center rounded p-0.5 transition-colors',
                  showDescription
                    ? 'text-foreground bg-muted'
                    : 'text-muted-foreground/60 hover:text-foreground hover:bg-muted/60',
                )}
                aria-label={showDescription ? 'Hide description' : 'Show description'}
                aria-expanded={showDescription}
                title={showDescription ? 'Hide description' : 'Show description'}
              >
                {showDescription ? <Note size={13} weight="fill" /> : <NoteBlank size={13} />}
              </button>
            )}
          </div>
          {node.dependsOn && node.dependsOn.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {node.dependsOn.map((dep, i) => (
                <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-600 border border-orange-500/20">
                  {dep}
                </span>
              ))}
            </div>
          )}
          {hasDescription && showDescription && (
            <p className="text-xs leading-relaxed text-muted-foreground mt-1.5 border-l-2 border-border/60 pl-2.5 whitespace-pre-wrap">
              {node.description}
            </p>
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
