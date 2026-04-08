import { useState } from 'react';
import { FolderOpen } from '@phosphor-icons/react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { useT } from '../../hooks/useLocale';

interface CreateOrgModalProps {
  onClose: () => void;
  onCreate: (name: string, description: string, workspacePath: string, customInstructions: string) => void;
}

export function CreateOrgModal({ onClose, onCreate }: CreateOrgModalProps) {
  const t = useT();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [workspacePath, setWorkspacePath] = useState('');
  const [customInstructions, setCustomInstructions] = useState('');

  const handleSelectFolder = async () => {
    const result = await window.capibara.selectFolder();
    if (result.ok && result.data) {
      setWorkspacePath(result.data);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t.createOrg.title}</DialogTitle>
          <DialogDescription className="sr-only">
            {t.createOrg.subtitle}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div>
            <Label htmlFor="org-name" className="mb-1">
              {t.createOrg.nameLabel} *
            </Label>
            <Input
              id="org-name"
              placeholder={t.createOrg.namePlaceholder}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
            />
          </div>
          <div>
            <Label htmlFor="org-desc" className="mb-1">
              {t.createOrg.descriptionLabel}
            </Label>
            <Input
              id="org-desc"
              placeholder={t.createOrg.descriptionPlaceholder}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
            />
          </div>
          <div>
            <Label htmlFor="org-workspace" className="mb-1">
              {t.createOrg.workspaceLabel} *
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="org-workspace"
                className="flex-1 bg-muted cursor-default"
                placeholder={t.createOrg.workspacePlaceholder}
                value={workspacePath}
                readOnly
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleSelectFolder}
              >
                <FolderOpen size={16} />
                {t.common.browse}
              </Button>
            </div>
          </div>
          <div>
            <Label htmlFor="org-instructions" className="mb-1">
              {t.createOrg.customInstructionsLabel}
            </Label>
            <textarea
              id="org-instructions"
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder={t.createOrg.customInstructionsPlaceholder}
              value={customInstructions}
              onChange={(e) => setCustomInstructions(e.target.value)}
              maxLength={5000}
              rows={4}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button
            onClick={() => onCreate(name.trim(), description.trim(), workspacePath, customInstructions.trim())}
            disabled={!name.trim() || !workspacePath}
          >
            {t.common.create}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
