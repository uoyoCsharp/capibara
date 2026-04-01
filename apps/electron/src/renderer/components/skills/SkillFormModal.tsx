import { useState } from 'react';
import { X } from '@phosphor-icons/react';
import type { SkillRecord, SkillCategory } from '@shared/contracts';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
} from '../ui/dialog';

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
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Edit Custom Skill' : 'Create Custom Skill'}
          </DialogTitle>
        </DialogHeader>

        {/* Body */}
        <div className="flex-1 overflow-auto space-y-5 py-2">
          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/30 px-4 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label>Name *</Label>
            <Input
              type="text"
              placeholder="My Custom Skill"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
            />
          </div>

          <div className="space-y-2">
            <Label>Command *</Label>
            <Input
              type="text"
              className="font-mono"
              placeholder="/my-skill"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              maxLength={200}
            />
            <p className="text-xs text-muted-foreground">Unique command identifier (e.g., /my-skill)</p>
          </div>

          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              rows={2}
              placeholder="What this skill does..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
            />
          </div>

          <div className="space-y-2">
            <Label>Category</Label>
            <Select
              value={category}
              onValueChange={(value) => setCategory(value as SkillCategory)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Prompt Content</Label>
            <Textarea
              className="font-mono"
              rows={8}
              placeholder="Enter the prompt template content..."
              value={promptContent}
              onChange={(e) => setPromptContent(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              The prompt content that will be injected when this skill is used by a role.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!name.trim() || !command.trim() || isSaving}
          >
            {isSaving ? 'Saving...' : isEditing ? 'Update Skill' : 'Create Skill'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
