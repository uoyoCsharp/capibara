import { create } from 'zustand';
import type {
  DiscussionGroupRecord,
  DiscussionMessageRecord,
  VoteStatsRecord,
  PostDiscussionMessageInput,
  RoleRecord,
  TaskRecord,
} from '@shared/contracts';

interface DiscussionState {
  groups: DiscussionGroupRecord[];
  tasks: TaskRecord[];
  roles: RoleRecord[];
  currentOrgId: string | null;
  selectedGroupId: string | null;
  messages: DiscussionMessageRecord[];
  voteStats: VoteStatsRecord | null;
  isLoading: boolean;

  setCurrentOrgId: (orgId: string | null) => void;
  setSelectedGroupId: (id: string | null) => void;
  loadGroups: (orgId: string) => Promise<void>;
  loadTasks: (orgId: string) => Promise<void>;
  loadRoles: (orgId: string) => Promise<void>;
  loadMessages: (groupId: string) => Promise<void>;
  loadVoteStats: (groupId: string) => Promise<void>;
  postMessage: (input: PostDiscussionMessageInput) => Promise<boolean>;
}

export const useDiscussionStore = create<DiscussionState>((set, get) => ({
  groups: [],
  tasks: [],
  roles: [],
  currentOrgId: null,
  selectedGroupId: null,
  messages: [],
  voteStats: null,
  isLoading: false,

  setCurrentOrgId: (orgId) => set({ currentOrgId: orgId }),
  setSelectedGroupId: (id) => set({ selectedGroupId: id }),

  loadGroups: async (orgId: string) => {
    set({ isLoading: true });
    const result = await window.capibara.getDiscussionGroupsByOrgId(orgId);
    if (result.ok) {
      set({ groups: result.data, isLoading: false });
    } else {
      set({ isLoading: false });
    }
  },

  loadTasks: async (orgId: string) => {
    const result = await window.capibara.getTasksByOrgId(orgId);
    if (result.ok) {
      set({ tasks: result.data });
    }
  },

  loadRoles: async (orgId: string) => {
    const result = await window.capibara.getRolesByOrgId(orgId);
    if (result.ok) {
      set({ roles: result.data });
    }
  },

  loadMessages: async (groupId: string) => {
    const result = await window.capibara.getDiscussionMessages(groupId);
    if (result.ok) {
      set({ messages: result.data });
    }
  },

  loadVoteStats: async (groupId: string) => {
    const result = await window.capibara.getDiscussionVoteStats(groupId);
    if (result.ok) {
      set({ voteStats: result.data });
    }
  },

  postMessage: async (input: PostDiscussionMessageInput) => {
    const result = await window.capibara.postDiscussionMessage(input);
    if (result.ok) {
      const { selectedGroupId } = get();
      if (selectedGroupId) {
        await get().loadMessages(selectedGroupId);
        await get().loadVoteStats(selectedGroupId);
      }
      return true;
    }
    return false;
  },
}));
