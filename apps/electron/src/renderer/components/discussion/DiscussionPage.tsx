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
import { DiscussionGroupPanel } from './DiscussionGroupPanel';

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
    const result = await window.capibara.getOrganizations();
    if (result.ok) {
      setOrganizations(result.data);
      if (result.data.length > 0 && !currentOrgId) {
        setCurrentOrgId(result.data[0].id);
      }
    }
  }, [currentOrgId]);

  const loadGroups = useCallback(async () => {
    if (!currentOrgId) {
      setGroups([]);
      return;
    }
    const result = await window.capibara.getDiscussionGroupsByOrgId(currentOrgId);
    if (result.ok) {
      setGroups(result.data);
    }
  }, [currentOrgId]);

  const loadTasks = useCallback(async () => {
    if (!currentOrgId) { setTasks([]); return; }
    const result = await window.capibara.getTasksByOrgId(currentOrgId);
    if (result.ok) setTasks(result.data);
  }, [currentOrgId]);

  const loadRoles = useCallback(async () => {
    if (!currentOrgId) { setRoles([]); return; }
    const result = await window.capibara.getRolesByOrgId(currentOrgId);
    if (result.ok) setRoles(result.data);
  }, [currentOrgId]);

  const loadMessages = useCallback(async (groupId: string) => {
    const result = await window.capibara.getDiscussionMessages(groupId);
    if (result.ok) setMessages(result.data);
  }, []);

  const loadVoteStats = useCallback(async (groupId: string) => {
    const result = await window.capibara.getDiscussionVoteStats(groupId);
    if (result.ok) setVoteStats(result.data);
  }, []);

  useEffect(() => {
    loadOrgs().then(() => setIsLoading(false));
  }, [loadOrgs]);

  useEffect(() => {
    loadGroups();
    loadTasks();
    loadRoles();
  }, [loadGroups, loadTasks, loadRoles]);

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
  };

  const handleRefresh = useCallback(() => {
    if (selectedGroupId) {
      loadMessages(selectedGroupId);
      loadVoteStats(selectedGroupId);
    }
  }, [selectedGroupId, loadMessages, loadVoteStats]);

  // Subscribe to events
  useEffect(() => {
    const unsub = window.capibara.subscribe((event) => {
      if (event.type === 'discussion:changed' && event.orgId === currentOrgId) {
        loadGroups();
      }
      if (event.type === 'discussion:message-added' && event.groupId === selectedGroupId) {
        loadMessages(event.groupId);
        loadVoteStats(event.groupId);
      }
    });
    return unsub;
  }, [currentOrgId, selectedGroupId, loadGroups, loadMessages, loadVoteStats]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-gray-400">Loading...</p>
      </div>
    );
  }

  if (organizations.length === 0) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">Discussions</h1>
        <p className="text-gray-500 mb-8">
          Create an organization first to see discussions.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Sidebar: Group list */}
      <div className="w-80 border-r border-gray-200 bg-white flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100">
          <h1 className="text-lg font-semibold text-gray-900 mb-3">Discussions</h1>
          <select
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            value={currentOrgId ?? ''}
            onChange={(e) => {
              setCurrentOrgId(e.target.value);
              setSelectedGroupId(null);
              setMessages([]);
              setVoteStats(null);
            }}
          >
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>{org.name}</option>
            ))}
          </select>
        </div>

        {/* Group list */}
        <div className="flex-1 overflow-auto py-2">
          {groups.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <ChatCircleDots size={32} className="mx-auto text-gray-300 mb-2" />
              <p className="text-sm text-gray-400">
                No discussion groups yet. Create an epic task to auto-generate one.
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
                  className={`w-full text-left px-5 py-3 border-b border-gray-50 transition-colors ${
                    isSelected
                      ? 'bg-indigo-50 border-l-2 border-l-indigo-500'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-sm font-medium text-gray-900 truncate">
                      {task?.title ?? 'Unknown Epic'}
                    </span>
                    {group.status === 'archived' && (
                      <span className="text-xs text-gray-400 ml-2">Archived</span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500">
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
              <ChatCircleDots size={48} className="mx-auto text-gray-300 mb-3" />
              <p className="text-sm text-gray-400">
                Select a discussion group to view messages and vote.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
