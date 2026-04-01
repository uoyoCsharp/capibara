import { useEffect, useState, useCallback, useMemo } from 'react';
import { ChatCircleDots } from '@phosphor-icons/react';
import type {
  OrganizationRecord,
  DiscussionGroupRecord,
  DiscussionMessageRecord,
  VoteStatsRecord,
  TaskRecord,
  RoleRecord,
  VoteTag,
} from '@shared/contracts';
import { cn } from '../../lib/utils';
import { DiscussionGroupPanel } from './DiscussionGroupPanel';
import { toast } from '../../store/toast.store';
import { Badge } from '../ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

export function DiscussionPage() {
  const [organizations, setOrganizations] = useState<OrganizationRecord[]>([]);
  const [currentOrgId, setCurrentOrgId] = useState<string | null>(null);
  const [groups, setGroups] = useState<DiscussionGroupRecord[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DiscussionMessageRecord[]>([]);
  const [voteStats, setVoteStats] = useState<VoteStatsRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadOrgs = useCallback(async () => {
    try {
      const result = await window.capibara.getOrganizations();
      if (result.ok) {
        setOrganizations(result.data);
        if (result.data.length > 0) {
          setCurrentOrgId((prev) => prev ?? result.data[0].id);
        }
      }
    } catch {
      toast.error('Failed to load organizations');
    }
  }, []);

  const loadOrgData = useCallback(async (orgId: string | null) => {
    if (!orgId) {
      setGroups([]);
      setTasks([]);
      setRoles([]);
      return;
    }
    try {
      const [groupRes, taskRes, roleRes] = await Promise.all([
        window.capibara.getDiscussionGroupsByOrgId(orgId),
        window.capibara.getTasksByOrgId(orgId),
        window.capibara.getRolesByOrgId(orgId),
      ]);
      if (groupRes.ok) setGroups(groupRes.data);
      if (taskRes.ok) setTasks(taskRes.data);
      if (roleRes.ok) setRoles(roleRes.data);
    } catch {
      toast.error('Failed to load discussion data');
    }
  }, []);

  const loadMessages = useCallback(async (groupId: string) => {
    try {
      const result = await window.capibara.getDiscussionMessages(groupId);
      if (result.ok) setMessages(result.data);
    } catch { toast.error('Failed to load messages'); }
  }, []);

  const loadVoteStats = useCallback(async (groupId: string) => {
    try {
      const result = await window.capibara.getDiscussionVoteStats(groupId);
      if (result.ok) setVoteStats(result.data);
    } catch { /* IPC may fail */ }
  }, []);

  useEffect(() => {
    loadOrgs().finally(() => setIsLoading(false));
  }, [loadOrgs]);

  useEffect(() => {
    loadOrgData(currentOrgId);
  }, [currentOrgId, loadOrgData]);

  useEffect(() => {
    if (selectedGroupId) {
      loadMessages(selectedGroupId);
      loadVoteStats(selectedGroupId);
    }
  }, [selectedGroupId, loadMessages, loadVoteStats]);

  const selectedGroup = useMemo(
    () => groups.find((g) => g.id === selectedGroupId) ?? null,
    [groups, selectedGroupId],
  );

  const taskMap = useMemo(() => {
    const map = new Map<string, TaskRecord>();
    for (const t of tasks) map.set(t.id, t);
    return map;
  }, [tasks]);

  const handlePostMessage = async (content: string, voteTag: VoteTag) => {
    if (!selectedGroupId) return;
    try {
      const result = await window.capibara.postDiscussionMessage({
        groupId: selectedGroupId,
        authorRoleId: null,
        authorType: 'human',
        content,
        voteTag,
      });
      if (result.ok) {
        await loadMessages(selectedGroupId);
        await loadVoteStats(selectedGroupId);
      }
    } catch { toast.error('Failed to post message'); }
  };

  const handleRefresh = useCallback(() => {
    if (selectedGroupId) {
      loadMessages(selectedGroupId);
      loadVoteStats(selectedGroupId);
    }
  }, [selectedGroupId, loadMessages, loadVoteStats]);

  // Subscribe to events
  useEffect(() => {
    if (typeof window.capibara?.subscribe !== 'function') return;
    const unsub = window.capibara.subscribe((event) => {
      if (event.type === 'discussion:changed' && event.orgId === currentOrgId) {
        loadOrgData(currentOrgId);
      }
      if (event.type === 'discussion:message-added' && event.groupId === selectedGroupId) {
        loadMessages(event.groupId);
        loadVoteStats(event.groupId);
      }
    });
    return unsub;
  }, [currentOrgId, selectedGroupId, loadOrgData, loadMessages, loadVoteStats]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (organizations.length === 0) {
    return (
      <div className="p-[var(--page-padding)]">
        <h1 className="text-3xl font-semibold text-foreground font-[family-name:var(--font-display)] mb-2">Discussions</h1>
        <p className="text-muted-foreground mb-8">
          Create an organization first to start discussions. Discussions are automatically created for epic-level tasks, where AI agents debate and vote on decisions.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Sidebar: Group list */}
      <div className="w-80 shrink-0 border-r border-border bg-card flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border">
          <h1 className="text-lg font-semibold text-foreground font-[family-name:var(--font-display)] mb-3">Discussions</h1>
          <Select
            value={currentOrgId ?? ''}
            onValueChange={(value) => {
              setCurrentOrgId(value);
              setSelectedGroupId(null);
              setMessages([]);
              setVoteStats(null);
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {organizations.map((org) => (
                <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Group list */}
        <div className="flex-1 overflow-auto py-3">
          {groups.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <ChatCircleDots size={32} className="mx-auto text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground">
                No discussions yet. Discussions appear automatically when you create epic-level tasks in the Execution tab.
              </p>
            </div>
          ) : (
            groups.map((group) => {
              const task = taskMap.get(group.taskNodeId);
              const isSelected = group.id === selectedGroupId;
              return (
                <button
                  key={group.id}
                  onClick={() => setSelectedGroupId(group.id)}
                  className={cn(
                    'w-full text-left px-5 py-3.5 border-b border-border transition-colors',
                    isSelected
                      ? 'bg-primary/10 border-l-2 border-l-primary'
                      : 'hover:bg-muted',
                  )}
                >
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-sm font-medium text-foreground truncate">
                      {task?.title ?? 'Unknown Epic'}
                    </span>
                    {group.status === 'archived' && (
                      <Badge variant="secondary" className="ml-2 text-xs">Archived</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Created {new Date(group.createdAt).toLocaleDateString()}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Main: Selected group panel */}
      <div className="flex-1">
        {selectedGroup ? (
          <DiscussionGroupPanel
            group={selectedGroup}
            messages={messages}
            voteStats={voteStats}
            roles={roles}
            tasks={tasks}
            onClose={() => setSelectedGroupId(null)}
            onPostMessage={handlePostMessage}
            onRefresh={handleRefresh}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <ChatCircleDots size={48} className="mx-auto text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">
                Select a discussion to view the conversation, see how AI agents voted, and add your own input.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
