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
import { useT } from '../../hooks/useLocale';

interface SkillFormModalProps {
  skill: SkillRecord | null;
  onClose: () => void;
  onSaved: () => void;
}

const CATEGORIES: SkillCategory[] = ['analysis', 'design', 'implementation', 'review', 'test', 'general'];

export function SkillFormModal({ skill, onClose, onSaved }: SkillFormModalProps) {
  const t = useT();
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
      setError(t.skillForm.nameCommandRequired);
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
            {isEditing ? t.skillForm.editTitle : t.skillForm.createTitle}
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
            <Label>{t.skillForm.nameLabel} *</Label>
            <Input
              type="text"
              placeholder={t.skillForm.namePlaceholder}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
            />
          </div>

          <div className="space-y-2">
            <Label>{t.skillForm.commandLabel} *</Label>
            <Input
              type="text"
              className="font-mono"
              placeholder={t.skillForm.commandPlaceholder}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              maxLength={200}
            />
            <p className="text-xs text-muted-foreground">{t.skillForm.commandHint}</p>
          </div>

          <div className="space-y-2">
            <Label>{t.skillForm.descriptionLabel}</Label>
            <Textarea
              rows={2}
              placeholder={t.skillForm.descriptionPlaceholder}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
            />
          </div>

          <div className="space-y-2">
            <Label>{t.skillForm.categoryLabel}</Label>
            <Select
              value={category}
              onValueChange={(value) => setCategory(value as SkillCategory)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>{t.skillCategories[c]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t.skillForm.promptContentLabel}</Label>
            <Textarea
              className="font-mono"
              rows={8}
              placeholder={t.skillForm.promptPlaceholder}
              value={promptContent}
              onChange={(e) => setPromptContent(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t.skillForm.promptHint}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button
            onClick={handleSave}
            disabled={!name.trim() || !command.trim() || isSaving}
          >
            {isSaving ? t.common.saving : isEditing ? t.skillForm.updateSkill : t.skillForm.createSkill}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
