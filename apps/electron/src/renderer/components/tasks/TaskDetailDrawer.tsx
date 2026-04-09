import { useEffect, useState } from 'react';
import { X, Trash, Play, ChatCircleDots, Terminal } from '@phosphor-icons/react';
import type {
  TaskRecord,
  TaskStatus,
  RoleRecord,
  RunRecord,
  DiscussionMessageRecord,
  WorkflowSchemaRecord,
} from '@shared/contracts';
import { cn } from '../../lib/utils';
import { useElapsedTimer } from '../../hooks/useElapsedTimer';
import { RunLogViewer } from '../shared/RunLogViewer';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import { MarkdownContent } from '../shared/MarkdownContent';
import { toast } from '../../store/toast.store';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Separator } from '../ui/separator';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
} from '../ui/sheet';
import { useT } from '../../hooks/useLocale';
import type { WorkflowSchemaHelpers } from '../../hooks/useWorkflowSchema';

/** Color mapping for status badge by category */
const STATUS_BADGE_CATEGORY_COLORS: Record<string, string> = {
  initial: 'bg-muted text-muted-foreground',
  active: 'bg-yellow-500/10 text-yellow-600',
  review: 'bg-orange-500/10 text-orange-600',
  terminal: 'bg-green-500/10 text-green-600',
};

const STATUS_BADGE_OVERRIDE_COLORS: Record<string, string> = {
  blocked: 'bg-destructive/10 text-destructive',
  cancelled: 'bg-muted text-muted-foreground',
  revision: 'bg-amber-500/10 text-amber-600',
  approved: 'bg-blue-500/10 text-blue-600',
};

function getStatusBadgeColor(statusName: string, schema: WorkflowSchemaRecord | null): string {
  if (STATUS_BADGE_OVERRIDE_COLORS[statusName]) return STATUS_BADGE_OVERRIDE_COLORS[statusName];
  if (!schema) return 'bg-muted text-muted-foreground';
  const def = schema.statuses.find((s) => s.name === statusName);
  if (!def) return 'bg-muted text-muted-foreground';
  return STATUS_BADGE_CATEGORY_COLORS[def.category] ?? 'bg-muted text-muted-foreground';
}

interface TaskDetailDrawerProps {
  task: TaskRecord;
  roles: RoleRecord[];
  onClose: () => void;
  onStatusChange: (id: string, status: TaskStatus) => void;
  onDelete: (id: string) => void;
  onStartRun?: (taskId: string, roleId: string) => void;
  hasActiveRun?: boolean;
  schemaHelpers: WorkflowSchemaHelpers;
}

export function TaskDetailDrawer({
  task,
  roles,
  onClose,
  onStatusChange,
  onDelete,
  onStartRun,
  hasActiveRun,
  schemaHelpers,
}: TaskDetailDrawerProps) {
  const t = useT();
  const assignee = task.assigneeRoleId
    ? roles.find((r) => r.id === task.assigneeRoleId)
    : null;

  const [latestRun, setLatestRun] = useState<RunRecord | null>(null);
  const [messages, setMessages] = useState<DiscussionMessageRecord[]>([]);
  const [contextTab, setContextTab] = useState<string>('output');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const isRunActive = latestRun != null && (latestRun.status === 'running' || latestRun.status === 'queued');
  const elapsed = useElapsedTimer(
    latestRun?.status === 'running' ? latestRun.startedAt : null
  );

  // Derive transitions from schema
  const manualTransitions = schemaHelpers.getManualTransitions(task.status);
  const validTransitions = [task.status, ...manualTransitions];

  // Derive review/blocked status from schema
  const needsReview = schemaHelpers.isReviewStatus(task.status) &&
    assignee != null && assignee.requiresHumanApproval === true;

  // Load run history and discussion for this task
  useEffect(() => {
    (async () => {
      try {
        const runRes = await window.capibara.getRunsByTaskId(task.id);
        if (runRes.ok && runRes.data.length > 0) {
          const sorted = [...runRes.data].sort(
            (a, b) => b.createdAt.localeCompare(a.createdAt),
          );
          setLatestRun(sorted[0]);
        } else {
          setLatestRun(null);
        }
      } catch { toast.error(t.errors.failedToLoad); }

      try {
        const groupRes = await window.capibara.getDiscussionGroupByTaskNodeId(task.id);
        if (groupRes.ok && groupRes.data) {
          const msgRes = await window.capibara.getDiscussionMessages(groupRes.data.id);
          if (msgRes.ok) setMessages(msgRes.data);
        } else {
          setMessages([]);
        }
      } catch { setMessages([]); }
    })();
  }, [task.id]);

  // Refresh run data on run events
  useEffect(() => {
    if (typeof window.capibara?.subscribe !== 'function') return;
    const unsub = window.capibara.subscribe((event) => {
      if (event.type === 'run:changed' || event.type === 'run:completed') {
        (async () => {
          try {
            const runRes = await window.capibara.getRunsByTaskId(task.id);
            if (runRes.ok && runRes.data.length > 0) {
              const sorted = [...runRes.data].sort(
                (a, b) => b.createdAt.localeCompare(a.createdAt),
              );
              setLatestRun(sorted[0]);
            }
          } catch { /* ignore */ }
        })();
      }
    });
    return unsub;
  }, [task.id]);

  const roleNameMap = new Map(roles.map((r) => [r.id, r.name]));

  // Find the first "approved" equivalent status (for review approve button)
  const approveTarget = schemaHelpers.schema?.transitions
    .find((tr) => tr.from === task.status && tr.trigger === 'manual' &&
      schemaHelpers.schema?.statuses.find((s) => s.name === tr.to)?.category === 'terminal')?.to
    ?? manualTransitions.find((s) => !schemaHelpers.isReviewStatus(s) && !schemaHelpers.isTerminalStatus(s));

  // Find the revision target
  const revisionTarget = manualTransitions.find((s) => {
    const def = schemaHelpers.schema?.statuses.find((st) => st.name === s);
    return def?.category === 'active';
  });

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="w-[var(--drawer-width)] sm:max-w-none p-0 flex flex-col">
        <SheetHeader className="px-5 py-4 border-b border-border">
          <SheetTitle className="font-[family-name:var(--font-display)]">{t.taskDetail.title}</SheetTitle>
        </SheetHeader>

        {/* Content */}
        <div className="flex-1 px-5 py-5 space-y-6 overflow-auto">
          {/* Review banner */}
          {needsReview && (
            <div className="rounded-lg bg-yellow-500/10 border border-yellow-500 px-4 py-3">
              <p className="text-sm font-medium text-yellow-600 mb-1">{t.taskDetail.awaitingReview}</p>
              <p className="text-xs text-yellow-600/80">
                {t.taskDetail.awaitingReviewMessage}
              </p>
              <div className="flex gap-2 mt-3">
                {approveTarget && (
                  <Button
                    size="sm"
                    onClick={() => onStatusChange(task.id, approveTarget)}
                    className="bg-green-500 hover:bg-green-500/90 text-white"
                  >
                    {t.taskDetail.approve}
                  </Button>
                )}
                {revisionTarget && (
                  <Button
                    size="sm"
                    onClick={() => onStatusChange(task.id, revisionTarget)}
                    className="bg-yellow-500 hover:bg-yellow-500/90 text-white"
                  >
                    {t.taskDetail.requestRevision}
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Blocked banner */}
          {task.status === 'blocked' && (
            <div className="rounded-lg bg-destructive/10 border border-destructive px-4 py-3">
              <p className="text-sm font-medium text-destructive mb-1">{t.taskDetail.blocked}</p>
              <p className="text-xs text-destructive/80">
                {t.taskDetail.blockedMessage}
              </p>
              <div className="flex gap-2 mt-3">
                {manualTransitions.filter((s) => !schemaHelpers.isTerminalStatus(s)).length > 0 && (
                  <Button
                    size="sm"
                    disabled={!task.assigneeRoleId || hasActiveRun}
                    onClick={() => {
                      const resumeTarget = manualTransitions.find((s) => !schemaHelpers.isTerminalStatus(s));
                      if (resumeTarget) {
                        onStatusChange(task.id, resumeTarget);
                        if (onStartRun && task.assigneeRoleId) {
                          setTimeout(() => onStartRun(task.id, task.assigneeRoleId!), 300);
                        }
                      }
                    }}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground"
                  >
                    <Play size={14} weight="fill" />
                    {t.taskDetail.retry}
                  </Button>
                )}
                {manualTransitions.some((s) => schemaHelpers.isTerminalStatus(s)) && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const cancelTarget = manualTransitions.find((s) => schemaHelpers.isTerminalStatus(s));
                      if (cancelTarget) onStatusChange(task.id, cancelTarget);
                    }}
                    className="border-destructive text-destructive hover:bg-destructive/10"
                  >
                    {t.common.cancel}
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Title */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
              {t.taskDetail.titleLabel}
            </label>
            <p className="text-sm text-foreground font-medium">{task.title}</p>
          </div>

          {/* Type + Status */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                {t.taskDetail.typeLabel}
              </label>
              <span className="text-sm font-medium text-muted-foreground capitalize">
                {schemaHelpers.typeLabel(task.type)}
              </span>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                {t.taskDetail.statusLabel}
              </label>
              <Select
                value={task.status}
                onValueChange={(value) => onStatusChange(task.id, value as TaskStatus)}
              >
                <SelectTrigger className={cn('w-auto h-auto px-2 py-1 text-xs font-semibold border-0', getStatusBadgeColor(task.status, schemaHelpers.schema))}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {validTransitions.map((s) => (
                    <SelectItem key={s} value={s}>
                      {schemaHelpers.statusLabel(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Assignee */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
              {t.taskDetail.assigneeLabel}
            </label>
            <span className="text-sm text-muted-foreground">
              {assignee ? assignee.name : t.common.unassigned}
            </span>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
              {t.taskDetail.descriptionLabel}
            </label>
            {task.description ? (
              <MarkdownContent content={task.description} className="text-sm text-muted-foreground" />
            ) : (
              <p className="text-sm text-muted-foreground">{t.common.noDescription}</p>
            )}
          </div>

          {/* Artifacts */}
          {task.artifactPaths && task.artifactPaths.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                {t.taskDetail.artifactsLabel}
              </label>
              <ul className="space-y-1">
                {task.artifactPaths.map((path, i) => (
                  <li key={i} className="text-xs text-primary font-mono truncate">
                    {path}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Context tabs: Run Output + Discussion */}
          {(latestRun || messages.length > 0) && (
            <Tabs value={contextTab} onValueChange={setContextTab}>
              <TabsList>
                {latestRun && (
                  <TabsTrigger value="output" className="gap-1">
                    <Terminal size={12} />
                    {t.taskDetail.runOutputTab}
                  </TabsTrigger>
                )}
                {messages.length > 0 && (
                  <TabsTrigger value="discussion" className="gap-1">
                    <ChatCircleDots size={12} />
                    {t.taskDetail.discussionTab} ({messages.length})
                  </TabsTrigger>
                )}
              </TabsList>

              {latestRun && (
                <TabsContent value="output">
                  <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
                    <Badge
                      variant="secondary"
                      className={cn(
                        'text-xs',
                        latestRun.status === 'succeeded' ? 'bg-green-500/10 text-green-600' :
                        latestRun.status === 'failed' ? 'bg-destructive/10 text-destructive' :
                        latestRun.status === 'running' ? 'bg-blue-500/10 text-blue-600' :
                        'bg-muted text-muted-foreground',
                      )}
                    >
                      {latestRun.status}
                    </Badge>
                    {elapsed && (
                      <span className="font-mono text-blue-600">{elapsed}</span>
                    )}
                    {latestRun.tokenCount > 0 && (
                      <span className="text-green-600">{(latestRun.tokenCount / 1_000_000).toFixed(4)}M</span>
                    )}
                    <span>{new Date(latestRun.createdAt).toLocaleString()}</span>
                  </div>
                  <RunLogViewer
                    runId={latestRun.id}
                    isActive={isRunActive}
                    maxHeight="max-h-64"
                  />
                </TabsContent>
              )}

              {messages.length > 0 && (
                <TabsContent value="discussion">
                  <div className="space-y-2 max-h-64 overflow-auto">
                    {messages.map((msg) => (
                      <div key={msg.id} className="rounded-lg bg-muted px-3 py-2">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-medium text-muted-foreground">
                            {msg.authorRoleId ? (roleNameMap.get(msg.authorRoleId) ?? 'Unknown') : msg.authorType}
                          </span>
                          {msg.voteTag && (
                            <Badge
                              variant="secondary"
                              className={cn(
                                'text-[10px] font-semibold',
                                msg.voteTag === 'APPROVE' ? 'bg-green-500/10 text-green-600' :
                                msg.voteTag === 'REVISE' ? 'bg-yellow-500/10 text-yellow-600' :
                                msg.voteTag === 'CONCERN' ? 'bg-destructive/10 text-destructive' :
                                'bg-blue-500/10 text-blue-600',
                              )}
                            >
                              {msg.voteTag}
                            </Badge>
                          )}
                          <span className="text-[10px] text-muted-foreground ml-auto">
                            {new Date(msg.createdAt).toLocaleTimeString()}
                          </span>
                        </div>
                        <MarkdownContent content={msg.content} className="text-xs text-muted-foreground" />
                      </div>
                    ))}
                  </div>
                </TabsContent>
              )}
            </Tabs>
          )}

          {/* Timestamps */}
          <div className="grid grid-cols-2 gap-4 text-xs text-muted-foreground">
            <div>
              <span className="block uppercase tracking-wide mb-0.5">{t.common.created}</span>
              {new Date(task.createdAt).toLocaleDateString()}
            </div>
            <div>
              <span className="block uppercase tracking-wide mb-0.5">{t.common.updated}</span>
              {new Date(task.updatedAt).toLocaleDateString()}
            </div>
          </div>
        </div>

        {/* Footer */}
        <SheetFooter className="border-t border-border px-5 py-4 flex items-center justify-between sm:justify-between">
          <Button
            variant="ghost"
            onClick={() => setShowDeleteConfirm(true)}
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
          >
            <Trash size={16} />
            {t.taskDetail.deleteTask}
          </Button>
          {onStartRun && task.assigneeRoleId && (
            <Button
              onClick={() => onStartRun(task.id, task.assigneeRoleId!)}
              disabled={hasActiveRun}
              variant={hasActiveRun ? 'secondary' : 'default'}
            >
              <Play size={16} weight="fill" />
              {hasActiveRun ? t.tasksExecution.running : t.tasksExecution.execute}
            </Button>
          )}
        </SheetFooter>
        {showDeleteConfirm && (
          <ConfirmDialog
            title={t.taskDetail.deleteTaskConfirm}
            message={t.taskDetail.deleteTaskMessage}
            confirmLabel="Delete"
            onConfirm={() => {
              onDelete(task.id);
              setShowDeleteConfirm(false);
            }}
            onCancel={() => setShowDeleteConfirm(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
