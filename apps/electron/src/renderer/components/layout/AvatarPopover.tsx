import { useEffect, useRef, useState } from 'react';
import { CaretUpDown, Check, Gear, Plus } from '@phosphor-icons/react';
import type { SectionId } from '@core/shared/types';
import { useT } from '../../hooks/use-locale';
import { cn } from '../../lib/utils';
import { Avatar, AvatarFallback } from '../ui/avatar';
import { Separator } from '../ui/separator';

const api = () => window.capibara;

interface AvatarPopoverProps {
  collapsed: boolean;
  organizations: Array<{ id: string; name: string }>;
  currentOrgId: string | null;
  onNavigate: (section: SectionId) => void;
  onCreateWorkspace?: () => void;
}

/**
 * Bottom-of-sidebar avatar + workspace switcher popover. Click-outside
 * handling is scoped to this component.
 */
export function AvatarPopover({
  collapsed, organizations, currentOrgId, onNavigate, onCreateWorkspace,
}: AvatarPopoverProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const t = useT();

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleSwitchOrg = async (orgId: string) => {
    if (orgId === currentOrgId) return;
    try {
      await api().setSetting('currentOrgId', orgId);
    } catch { /* silent */ }
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex w-full items-center gap-2 rounded-md p-1.5 hover:bg-sidebar-accent transition-colors text-left',
          collapsed && 'justify-center',
        )}
      >
        <Avatar className="h-8 w-8 shrink-0">
          <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">U</AvatarFallback>
        </Avatar>
        {!collapsed && (
          <>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">uoyo</p>
              <p className="text-[11px] text-muted-foreground truncate">Admin</p>
            </div>
            <CaretUpDown size={14} className="text-muted-foreground shrink-0" />
          </>
        )}
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-64 rounded-lg border bg-popover p-1.5 shadow-lg z-50">
          <p className="px-2 py-1 text-[11px] font-medium uppercase text-muted-foreground/60 tracking-wider">
            {t.workspace?.switchWorkspace ?? 'Switch Workspace'}
          </p>
          {organizations.map((org) => (
            <button
              key={org.id}
              type="button"
              onClick={() => handleSwitchOrg(org.id)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors',
                org.id === currentOrgId && 'bg-accent',
              )}
            >
              <span className="flex-1 truncate text-left">{org.name}</span>
              {org.id === currentOrgId && <Check size={14} className="text-primary shrink-0" />}
            </button>
          ))}
          <button
            type="button"
            onClick={() => { setOpen(false); onCreateWorkspace?.(); }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent transition-colors"
          >
            <Plus size={14} /> {t.workspace?.createNewSpace ?? 'Create New Workspace'}
          </button>

          <Separator className="my-1.5" />

          <button
            type="button"
            onClick={() => { setOpen(false); onNavigate('settings'); }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent transition-colors"
          >
            <Gear size={14} /> {t.workspace?.userPreferences ?? 'Settings'}
          </button>
        </div>
      )}
    </div>
  );
}
