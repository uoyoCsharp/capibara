import { useEffect, useState } from 'react';
import { X, Trash, Play, ChatCircleDots, Terminal } from '@phosphor-icons/react';
import type {
  TaskRecord,
  TaskStatus,
  RoleRecord,
  RunRecord,
  DiscussionMessageRecord,
} from '@shared/contracts';
import { cn } from '../../lib/utils';
import { useRunLogs } from '../../hooks/useRunLogs';
import { useElapsedTimer } from '../../hooks/useElapsedTimer';
import { ConfirmDialog } from '../shared/ConfirmDialog';
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

interface TaskDetailDrawerProps {
  task: TaskRecord;
  roles: RoleRecord[];
  onClose: () => void;
  onStatusChange: (id: string, status: TaskStatus) => void;
  onDelete: (id: string) => void;
  onStartRun?: (taskId: string, roleId: string) => void;
  hasActiveRun?: boolean;
}

const STATUS_OPTIONS: TaskStatus[] = [
  'pending',
  'in_progress',
  'awaiting_review',
  'revision',
  'approved',
  'done',
  'blocked',
  'cancelled',
];

const STATUS_COLORS: Record<TaskStatus, string> = {
  pending: 'bg-muted text-muted-foreground',
  in_progress: 'bg-yellow-500/10 text-yellow-600',
  awaiting_review: 'bg-yellow-500/10 text-yellow-600',
  revision: 'bg-yellow-500/10 text-yellow-600',
  approved: 'bg-green-500/10 text-green-600',
  done: 'bg-green-500/10 text-green-600',
  blocked: 'bg-destructive/10 text-destructive',
  cancelled: 'bg-muted text-muted-foreground',
};

export function TaskDetailDrawer({
  task,
  roles,
  onClose,
  onStatusChange,
  onDelete,
  onStartRun,
  hasActiveRun,
}: TaskDetailDrawerProps) {
  const t = useT();
  const assignee = task.assigneeRoleId
    ? roles.find((r) => r.id === task.assigneeRoleId)
    : null;

  const [latestRun, setLatestRun] = useState<RunRecord | null>(null);
  const [messages, setMessages] = useState<DiscussionMessageRecord[]>([]);
  const [contextTab, setContextTab] = useState<string>('output');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const activeRunId = latestRun && (latestRun.status === 'running' || latestRun.status === 'queued')
    ? latestRun.id : null;
  const { log: streamingLog, scrollRef } = useRunLogs(activeRunId);
  const elapsed = useElapsedTimer(
    latestRun?.status === 'running' ? latestRun.startedAt : null
  );

  // Load run history and discussion for this task
  useEffect(() => {
    (async () => {
      try {
        const runRes = await window.capibara.getRunsByTaskId(task.id);
        if (runRes.ok && runRes.data.length > 0) {
          // Most recent run first
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
        // Reload the latest run for this task
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
  const needsReview = task.status === 'awaiting_review';

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
                <Button
                  size="sm"
                  onClick={() => onStatusChange(task.id, 'approved')}
                  className="bg-green-500 hover:bg-green-500/90 text-white"
                >
                  {t.taskDetail.approve}
                </Button>
                <Button
                  size="sm"
                  onClick={() => onStatusChange(task.id, 'revision')}
                  className="bg-yellow-500 hover:bg-yellow-500/90 text-white"
                >
                  {t.taskDetail.requestRevision}
                </Button>
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
                {task.type}
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
                <SelectTrigger className={cn('w-auto h-auto px-2 py-1 text-xs font-semibold border-0', STATUS_COLORS[task.status])}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {t.task[s]}
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
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
              {task.description || t.common.noDescription}
            </p>
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
                    {latestRun.costUsd > 0 && (
                      <span className="text-green-600">${latestRun.costUsd.toFixed(4)}</span>
                    )}
                    <span>{new Date(latestRun.createdAt).toLocaleString()}</span>
                  </div>
                  {activeRunId ? (
                    <pre
                      ref={scrollRef}
                      className="bg-muted text-foreground rounded-lg p-3 text-xs overflow-auto max-h-64 font-mono leading-relaxed"
                    >
                      {streamingLog || t.tasksExecution.waitingForOutput}
                    </pre>
                  ) : latestRun.outputLog ? (
                    <pre className="bg-muted text-foreground rounded-lg p-3 text-xs overflow-auto max-h-64 font-mono leading-relaxed">
                      {latestRun.outputLog.slice(0, 8000)}
                      {latestRun.outputLog.length > 8000 && `\n${t.common.truncated}`}
                    </pre>
                  ) : (
                    <p className="text-xs text-muted-foreground">{t.tasksExecution.noOutputLog}</p>
                  )}
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
                        <p className="text-xs text-muted-foreground whitespace-pre-wrap">{msg.content}</p>
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
