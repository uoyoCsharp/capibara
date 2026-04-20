import { useEffect, useState, useCallback } from 'react';
import { TreeStructure, PaperPlaneTilt, Check, X, ChatCircle } from '@phosphor-icons/react';
import { usePlanningStore } from '../../store/planning.store';
import { useConversationStore } from '../../store/conversation.store';
import { useOrganizationStore } from '../../store/organization.store';
import { useEventSubscription } from '../../hooks/use-event-subscription';
import type { RoleRecord } from '@core/shared/types';

interface PlanningPageProps {
  orgId: string | null;
}

export function PlanningPage({ orgId }: PlanningPageProps) {
  const conversationId = usePlanningStore((s) => s.conversationId);
  const pendingPlan = usePlanningStore((s) => s.pendingPlan);
  const isLoading = usePlanningStore((s) => s.isLoading);
  const startPlanning = usePlanningStore((s) => s.start);
  const sendMessage = usePlanningStore((s) => s.sendMessage);
  const loadPending = usePlanningStore((s) => s.loadPendingPlan);
  const confirmPlan = usePlanningStore((s) => s.confirmPlan);
  const discardPlan = usePlanningStore((s) => s.discardPlan);
  const resetPlanning = usePlanningStore((s) => s.reset);

  const messages = useConversationStore((s) => s.messages);
  const loadMessages = useConversationStore((s) => s.loadMessages);

  const roles = useOrganizationStore((s) => s.roles);
  const loadRoles = useOrganizationStore((s) => s.loadRoles);

  const [input, setInput] = useState('');
  const [selectedRoleId, setSelectedRoleId] = useState('');

  useEffect(() => {
    if (orgId) void loadRoles(orgId);
  }, [orgId, loadRoles]);

  useEffect(() => {
    if (conversationId) {
      void loadMessages(conversationId);
      void loadPending(conversationId);
    }
  }, [conversationId, loadMessages, loadPending]);

  useEventSubscription(['planning:plan-ready', 'conversation:changed'], useCallback(() => {
    if (conversationId) {
      void loadMessages(conversationId);
      void loadPending(conversationId);
    }
  }, [conversationId, loadMessages, loadPending]));

  const aiRoles = roles.filter((r) => !r.isSystemRole && r.status === 'active');

  const handleStart = useCallback(async () => {
    if (!orgId || !input.trim() || !selectedRoleId) return;
    await startPlanning(orgId, selectedRoleId, input.trim());
    setInput('');
  }, [orgId, input, selectedRoleId, startPlanning]);

  const handleSend = useCallback(async () => {
    if (!conversationId || !input.trim()) return;
    await sendMessage(conversationId, input.trim());
    setInput('');
    void loadMessages(conversationId);
  }, [conversationId, input, sendMessage, loadMessages]);

  const handleConfirm = useCallback(async () => {
    if (!conversationId || !orgId) return;
    await confirmPlan(conversationId, orgId, null);
  }, [conversationId, orgId, confirmPlan]);

  const handleDiscard = useCallback(async () => {
    if (!conversationId) return;
    await discardPlan(conversationId);
  }, [conversationId, discardPlan]);

  if (!orgId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
        <TreeStructure size={48} weight="duotone" />
        <p>Select an organization to start planning</p>
      </div>
    );
  }

  if (!conversationId) {
    return (
      <div className="p-[var(--page-padding)] max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <TreeStructure size={28} weight="duotone" />
            Planning
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Describe what you want to build</p>
        </div>

        <div>
          <label className="text-sm font-medium">Planning Role</label>
          <select
            value={selectedRoleId}
            onChange={(e) => setSelectedRoleId(e.target.value)}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
          >
            <option value="">Select a role...</option>
            {aiRoles.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-sm font-medium">What do you want to plan?</label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={6}
            placeholder="Describe the features, goals, or work you need planned..."
            className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <button
          onClick={() => void handleStart()}
          disabled={isLoading || !input.trim() || !selectedRoleId}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          <PaperPlaneTilt size={16} />
          {isLoading ? 'Starting...' : 'Start Planning'}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ChatCircle size={20} weight="duotone" />
          <span className="font-medium">Planning Session</span>
        </div>
        <button onClick={resetPlanning} className="text-xs px-2 py-1 rounded border border-border hover:bg-accent transition-colors">
          New Session
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.authorType === 'human' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[70%] rounded-lg px-3 py-2 ${
              msg.authorType === 'human' ? 'bg-primary text-primary-foreground' : 'bg-accent'
            }`}>
              <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
            </div>
          </div>
        ))}
      </div>

      {pendingPlan && (
        <div className="p-4 border-t border-border bg-accent/50 space-y-3">
          <div className="flex items-center gap-2">
            <TreeStructure size={18} className="text-primary" />
            <span className="font-medium text-sm">Plan Ready</span>
            <span className="text-xs text-muted-foreground">({(pendingPlan.tasks as unknown[]).length} tasks)</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => void handleConfirm()}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-green-600 text-white text-sm hover:bg-green-700 transition-colors"
            >
              <Check size={14} weight="bold" />
              Confirm Plan
            </button>
            <button
              onClick={() => void handleDiscard()}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border text-sm hover:bg-accent transition-colors"
            >
              <X size={14} />
              Discard
            </button>
          </div>
        </div>
      )}

      <div className="p-4 border-t border-border flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void handleSend()}
          placeholder="Continue the conversation..."
          className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          onClick={() => void handleSend()}
          disabled={!input.trim()}
          className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          <PaperPlaneTilt size={16} />
        </button>
      </div>
    </div>
  );
}
