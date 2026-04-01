import { useState } from 'react';
import { X } from '@phosphor-icons/react';
import type { SkillRecord, SkillCategory } from '@shared/contracts';

interface SkillFormModalProps {
  skill: SkillRecord | null;
  onClose: () => void;
  onSaved: () => void;
}

const CATEGORIES: Array<{ value: SkillCategory; label: string }> = [
  { value: 'analysis', label: 'Analysis' },
  { value: 'design', label: 'Design' },
  { value: 'implementation', label: 'Implementation' },
  { value: 'review', label: 'Review' },
  { value: 'test', label: 'Test' },
  { value: 'general', label: 'General' },
];

export function SkillFormModal({ skill, onClose, onSaved }: SkillFormModalProps) {
  const isEditing = skill != null;
  const [name, setName] = useState(skill?.name ?? '');
  const [command, setCommand] = useState(skill?.command ?? '/');
  const [description, setDescription] = useState(skill?.description ?? '');
  const [category, setCategory] = useState<SkillCategory>(skill?.category ?? 'general');
  const [promptContent, setPromptContent] = useState(skill?.customPromptContent ?? '');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim() || !command.trim()) {
      setError('Name and command are required');
      return;
    }

    setIsSaving(true);
    setError('');

    try {
      if (isEditing) {
        const result = await window.capibara.updateSkill({
          id: skill.id,
          name: name.trim(),
          command: command.trim(),
          description: description.trim(),
          category,
          customPromptContent: promptContent.trim() || null,
        });
        if (!result.ok) {
          setError(result.error.message);
          return;
        }
      } else {
        const result = await window.capibara.createSkill({
          name: name.trim(),
          command: command.trim(),
          description: description.trim(),
          category,
          source: 'custom',
          orgTemplateId: null,
          customPromptContent: promptContent.trim() || null,
        });
        if (!result.ok) {
          setError(result.error.message);
          return;
        }
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-overlay">
      <div className="bg-surface-card rounded-[var(--card-radius)] shadow-modal w-full max-w-lg mx-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
          <h2 className="text-lg font-semibold text-text-primary">
            {isEditing ? 'Edit Custom Skill' : 'Create Custom Skill'}
          </h2>
          <button
            className="p-1 rounded-lg text-text-muted hover:text-text-secondary hover:bg-surface-sunken"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-6 space-y-5">
          {error && (
            <div className="rounded-lg bg-danger-subtle border border-danger/30 px-4 py-2 text-sm text-danger-text">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Name *</label>
            <input
              type="text"
              className="w-full rounded-lg border border-border-default bg-surface-card px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent placeholder-text-muted"
              placeholder="My Custom Skill"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Command *</label>
            <input
              type="text"
              className="w-full rounded-lg border border-border-default bg-surface-card px-3 py-2 text-sm font-mono text-text-primary focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent placeholder-text-muted"
              placeholder="/my-skill"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              maxLength={200}
            />
            <p className="text-xs text-text-muted mt-1">Unique command identifier (e.g., /my-skill)</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Description</label>
            <textarea
              className="w-full rounded-lg border border-border-default bg-surface-card px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent resize-y placeholder-text-muted"
              rows={2}
              placeholder="What this skill does..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Category</label>
            <select
              className="w-full rounded-lg border border-border-default bg-surface-card px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
              value={category}
              onChange={(e) => setCategory(e.target.value as SkillCategory)}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              Prompt Content
            </label>
            <textarea
              className="w-full rounded-lg border border-border-default bg-surface-card px-3 py-2 text-sm font-mono text-text-primary focus:outline-none focus:ring-2 focus:ring-accent resize-y placeholder-text-muted"
              rows={8}
              placeholder="Enter the prompt template content..."
              value={promptContent}
              onChange={(e) => setPromptContent(e.target.value)}
            />
            <p className="text-xs text-text-muted mt-1">
              The prompt content that will be injected when this skill is used by a role.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border-subtle">
          <button
            className="rounded-lg border border-border-default px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface-sunken"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-text-inverse hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleSave}
            disabled={!name.trim() || !command.trim() || isSaving}
          >
            {isSaving ? 'Saving...' : isEditing ? 'Update Skill' : 'Create Skill'}
          </button>
        </div>
      </div>
    </div>
  );
}
