import { useState, useEffect, useCallback } from 'react';
import { X, Trash, FloppyDisk } from '@phosphor-icons/react';
import type { RoleRecord, UpdateRoleInput, SkillRecord } from '@shared/contracts';
import { SkillSelector } from './SkillSelector';

interface RoleDrawerProps {
  role: RoleRecord;
  roles: RoleRecord[];
  onUpdate: (input: UpdateRoleInput) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export function RoleDrawer({ role, roles, onUpdate, onDelete, onClose }: RoleDrawerProps) {
  const [name, setName] = useState(role.name);
  const [persona, setPersona] = useState(role.persona);
  const [canApprove, setCanApprove] = useState(role.canApprove);
  const [canDelegate, setCanDelegate] = useState(role.canDelegate);
  const [requiresHumanApproval, setRequiresHumanApproval] = useState(role.requiresHumanApproval);
  const [status, setStatus] = useState(role.status);
  const [parentId, setParentId] = useState(role.parentId);
  const [skillIds, setSkillIds] = useState<string[]>(role.skillIds);
  const [knowledgeBaseRefs, setKnowledgeBaseRefs] = useState(role.knowledgeBaseRefs.join('\n'));
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  // Reset state when role changes
  useEffect(() => {
    setName(role.name);
    setPersona(role.persona);
    setCanApprove(role.canApprove);
    setCanDelegate(role.canDelegate);
    setRequiresHumanApproval(role.requiresHumanApproval);
    setStatus(role.status);
    setParentId(role.parentId);
    setSkillIds(role.skillIds);
    setKnowledgeBaseRefs(role.knowledgeBaseRefs.join('\n'));
    setIsDirty(false);
    setShowDeleteConfirm(false);
  }, [role]);

  const markDirty = useCallback(() => setIsDirty(true), []);

  const handleSave = () => {
    if (!name.trim()) return;
    const refs = knowledgeBaseRefs
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    onUpdate({
      id: role.id,
      name: name.trim(),
      persona,
      canApprove,
      canDelegate,
      requiresHumanApproval,
      status,
      skillIds,
      knowledgeBaseRefs: refs,
    });
    setIsDirty(false);
  };

  const handleDelete = () => {
    const hasChildren = roles.some((r) => r.parentId === role.id);
    if (hasChildren) {
      setShowDeleteConfirm(true);
    } else {
      onDelete(role.id);
    }
  };

  // Exclude self and descendants from parent options
  const getDescendantIds = (id: string): string[] => {
    const children = roles.filter((r) => r.parentId === id);
    return [id, ...children.flatMap((c) => getDescendantIds(c.id))];
  };
  const excludeIds = new Set(getDescendantIds(role.id));
  const parentOptions = roles.filter((r) => !excludeIds.has(r.id));

  return (
    <div className="w-96 border-l border-border-default bg-surface-card flex flex-col h-full shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
        <h3 className="text-base font-semibold text-text-primary">Configure Role</h3>
        <button
          className="p-1 rounded-lg text-text-muted hover:text-text-secondary hover:bg-surface-sunken"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto px-5 py-5 space-y-6">
        {/* Name */}
        <div>
          <label className="block text-xs font-medium text-text-muted uppercase tracking-wider mb-1.5">
            Name
          </label>
          <input
            type="text"
            className="w-full rounded-lg border border-border-default bg-surface-card px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
            value={name}
            onChange={(e) => { setName(e.target.value); markDirty(); }}
            maxLength={100}
          />
          {!name.trim() && (
            <p className="text-xs text-danger mt-1">Name is required</p>
          )}
        </div>

        {/* Status */}
        <div>
          <label className="block text-xs font-medium text-text-muted uppercase tracking-wider mb-1.5">
            Status
          </label>
          <select
            className="w-full rounded-lg border border-border-default bg-surface-card px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            value={status}
            onChange={(e) => { setStatus(e.target.value as RoleRecord['status']); markDirty(); }}
          >
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="idle">Idle</option>
          </select>
        </div>

        {/* Parent Role */}
        <div>
          <label className="block text-xs font-medium text-text-muted uppercase tracking-wider mb-1.5">
            Parent Role
          </label>
          <select
            className="w-full rounded-lg border border-border-default bg-surface-card px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            value={parentId ?? ''}
            onChange={(e) => { setParentId(e.target.value || null); markDirty(); }}
          >
            <option value="">None (Root)</option>
            {parentOptions.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>

        {/* Persona */}
        <div>
          <label className="block text-xs font-medium text-text-muted uppercase tracking-wider mb-1.5">
            Persona
          </label>
          <textarea
            className="w-full rounded-lg border border-border-default bg-surface-card px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent resize-y min-h-[100px]"
            rows={5}
            value={persona}
            onChange={(e) => { setPersona(e.target.value); markDirty(); }}
            placeholder="Describe the role's persona, responsibilities, and behavior..."
          />
        </div>

        {/* Skills */}
        <div>
          <label className="block text-xs font-medium text-text-muted uppercase tracking-wider mb-1.5">
            Skills
          </label>
          <SkillSelector
            selectedIds={skillIds}
            onChange={(ids) => { setSkillIds(ids); markDirty(); }}
          />
        </div>

        {/* Knowledge Base Refs */}
        <div>
          <label className="block text-xs font-medium text-text-muted uppercase tracking-wider mb-1.5">
            Knowledge Base References
          </label>
          <textarea
            className="w-full rounded-lg border border-border-default bg-surface-card px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent resize-y"
            rows={3}
            value={knowledgeBaseRefs}
            onChange={(e) => { setKnowledgeBaseRefs(e.target.value); markDirty(); }}
            placeholder="One reference per line..."
          />
        </div>

        {/* Permissions */}
        <div>
          <label className="block text-xs font-medium text-text-muted uppercase tracking-wider mb-2">
            Permissions
          </label>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-text-secondary">
              <input
                type="checkbox"
                className="rounded border-border-default text-accent focus:ring-accent"
                checked={canApprove}
                onChange={(e) => { setCanApprove(e.target.checked); markDirty(); }}
              />
              Can Approve
            </label>
            <label className="flex items-center gap-2 text-sm text-text-secondary">
              <input
                type="checkbox"
                className="rounded border-border-default text-accent focus:ring-accent"
                checked={canDelegate}
                onChange={(e) => { setCanDelegate(e.target.checked); markDirty(); }}
              />
              Can Delegate
            </label>
            <label className="flex items-center gap-2 text-sm text-text-secondary">
              <input
                type="checkbox"
                className="rounded border-border-default text-accent focus:ring-accent"
                checked={requiresHumanApproval}
                onChange={(e) => { setRequiresHumanApproval(e.target.checked); markDirty(); }}
              />
              Requires Human Approval
            </label>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-5 py-4 border-t border-border-subtle">
        <button
          className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-danger hover:bg-danger-subtle transition-colors"
          onClick={handleDelete}
        >
          <Trash size={16} />
          Delete
        </button>
        <button
          className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-text-inverse hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          onClick={handleSave}
          disabled={!isDirty || !name.trim()}
        >
          <FloppyDisk size={16} />
          Save
        </button>
      </div>

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-overlay">
          <div className="bg-surface-card rounded-[var(--card-radius)] shadow-modal p-6 max-w-sm mx-4">
            <h4 className="font-semibold text-text-primary mb-2">Delete Role with Children?</h4>
            <p className="text-sm text-text-secondary mb-4">
              This role has child roles. They will become orphaned (moved to root level) after deletion.
            </p>
            <div className="flex justify-end gap-2">
              <button
                className="rounded-lg border border-border-default px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface-sunken"
                onClick={() => setShowDeleteConfirm(false)}
              >
                Cancel
              </button>
              <button
                className="rounded-lg bg-danger px-4 py-2 text-sm font-medium text-text-inverse hover:opacity-90"
                onClick={() => onDelete(role.id)}
              >
                Delete Anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
