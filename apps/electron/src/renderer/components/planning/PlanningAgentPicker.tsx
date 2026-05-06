import { useState } from 'react';
import type { RoleRecord } from '@core/shared/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { useT } from '../../hooks/use-locale';
import { cn } from '../../lib/utils';

interface PlanningAgentPickerProps {
  roles: RoleRecord[];
  onCancel: () => void;
  onConfirm: (agentRoleId: string) => void;
}

export function PlanningAgentPicker({ roles, onCancel, onConfirm }: PlanningAgentPickerProps) {
  const t = useT();
  const selectable = roles.filter((r) => !r.isSystemRole);
  const [selected, setSelected] = useState<string | null>(selectable[0]?.id ?? null);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t.planAgentPicker.title}</DialogTitle>
          <DialogDescription>
            {t.planAgentPicker.description}
          </DialogDescription>
        </DialogHeader>

        {selectable.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            {t.planAgentPicker.noRoles}
          </p>
        ) : (
          <div className="space-y-1.5 py-2 max-h-[50vh] overflow-y-auto pr-1">
            {selectable.map((role) => (
              <label
                key={role.id}
                className={cn(
                  'flex items-start gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors',
                  selected === role.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/30',
                )}
              >
                <input
                  type="radio"
                  name="planningAgent"
                  value={role.id}
                  checked={selected === role.id}
                  onChange={() => setSelected(role.id)}
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground">{role.name}</p>
                </div>
              </label>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t.common.cancel}
          </Button>
          <Button
            onClick={() => selected && onConfirm(selected)}
            disabled={!selected}
          >
            {t.planAgentPicker.continue}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
