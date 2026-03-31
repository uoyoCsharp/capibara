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
        setIsSaving(false);
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
        setIsSaving(false);
        return;
      }
    }

    setIsSaving(false);
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">
            {isEditing ? 'Edit Custom Skill' : 'Create Custom Skill'}
          </h2>
          <button
            className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-6 space-y-4">
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-600">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input
              type="text"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              placeholder="My Custom Skill"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Command *</label>
            <input
              type="text"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              placeholder="/my-skill"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              maxLength={200}
            />
            <p className="text-xs text-gray-400 mt-1">Unique command identifier (e.g., /my-skill)</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
              rows={2}
              placeholder="What this skill does..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
            <select
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={category}
              onChange={(e) => setCategory(e.target.value as SkillCategory)}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Prompt Content
            </label>
            <textarea
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
              rows={8}
              placeholder="Enter the prompt template content..."
              value={promptContent}
              onChange={(e) => setPromptContent(e.target.value)}
            />
            <p className="text-xs text-gray-400 mt-1">
              The prompt content that will be injected when this skill is used by a role.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
          <button
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
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
