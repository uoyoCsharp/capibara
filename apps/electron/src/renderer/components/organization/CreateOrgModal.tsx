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

interface CreateOrgModalProps {
  onClose: () => void;
  onCreate: (name: string, description: string, workspacePath: string) => void;
}

export function CreateOrgModal({ onClose, onCreate }: CreateOrgModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [workspacePath, setWorkspacePath] = useState('');

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
          <DialogTitle>Create Organization</DialogTitle>
          <DialogDescription className="sr-only">
            Create a new blank organization
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div>
            <Label htmlFor="org-name" className="mb-1">
              Name *
            </Label>
            <Input
              id="org-name"
              placeholder="My Organization"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
            />
          </div>
          <div>
            <Label htmlFor="org-desc" className="mb-1">
              Description
            </Label>
            <Input
              id="org-desc"
              placeholder="Optional description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
            />
          </div>
          <div>
            <Label htmlFor="org-workspace" className="mb-1">
              Workspace Folder *
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="org-workspace"
                className="flex-1 bg-muted cursor-default"
                placeholder="Select a folder..."
                value={workspacePath}
                readOnly
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleSelectFolder}
              >
                <FolderOpen size={16} />
                Browse
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => onCreate(name.trim(), description.trim(), workspacePath)}
            disabled={!name.trim() || !workspacePath}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
