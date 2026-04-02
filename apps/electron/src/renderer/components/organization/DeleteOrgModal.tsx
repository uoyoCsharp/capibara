import { useState } from 'react';
import { Warning } from '@phosphor-icons/react';
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

interface DeleteOrgModalProps {
  orgName: string;
  onClose: () => void;
  onConfirm: () => void;
}

export function DeleteOrgModal({ orgName, onClose, onConfirm }: DeleteOrgModalProps) {
  const t = useT();
  const [confirmName, setConfirmName] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const nameMatches = confirmName === orgName;

  const handleDelete = async () => {
    if (!nameMatches) return;
    setIsDeleting(true);
    onConfirm();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-destructive">{t.deleteOrg.title}</DialogTitle>
          <DialogDescription className="sr-only">
            {t.deleteOrg.subtitle}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg bg-destructive/10 border border-destructive/20 p-3">
            <Warning size={20} className="text-destructive mt-0.5 shrink-0" />
            <p className="text-sm text-muted-foreground">
              {t.deleteOrg.warning.split('{orgName}')[0]}
              <strong className="text-foreground">{orgName}</strong>
              {t.deleteOrg.warning.split('{orgName}')[1]}
            </p>
          </div>

          <div>
            <Label htmlFor="confirm-name" className="mb-1">
              {t.deleteOrg.typeToConfirm.split('{orgName}')[0]}
              <strong className="text-foreground">{orgName}</strong>
              {t.deleteOrg.typeToConfirm.split('{orgName}')[1]}
            </Label>
            <Input
              id="confirm-name"
              placeholder={orgName}
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              autoFocus
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={!nameMatches || isDeleting}
          >
            {isDeleting ? t.deleteOrg.deleting : t.organization.deleteOrganization}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
