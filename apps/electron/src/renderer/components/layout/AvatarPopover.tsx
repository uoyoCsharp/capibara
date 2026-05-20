import { useEffect, useRef, useState } from 'react';
import { ArrowsLeftRight, CaretUpDown, Check, Plus } from '@phosphor-icons/react';
import { useT } from '../../hooks/use-locale';
import { useAppStore } from '../../store/app.store';
import { cn } from '../../lib/utils';

const api = () => window.capibara;

interface AvatarPopoverProps {
  collapsed: boolean;
  organizations: Array<{ id: string; name: string }>;
  currentOrgId: string | null;
  onCreateWorkspace?: () => void;
}

export function AvatarPopover({ collapsed, organizations, currentOrgId, onCreateWorkspace }: AvatarPopoverProps) {
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
      useAppStore.getState().setCurrentOrgId(orgId);
    } catch { /* silent */ }
    setOpen(false);
  };

  const currentOrg = organizations.find((o) => o.id === currentOrgId);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex w-full items-center gap-2 rounded-md p-1.5 hover:bg-sidebar-accent transition-colors text-left',
          collapsed && 'justify-center',
        )}
        title={t.workspace?.switchWorkspace ?? 'Switch Workspace'}
      >
        <ArrowsLeftRight size={18} className="text-muted-foreground shrink-0" />
        {!collapsed && (
          <>
            <span className="flex-1 text-sm text-muted-foreground truncate">
              {currentOrg?.name ?? (t.workspace?.switchWorkspace ?? 'Switch Workspace')}
            </span>
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
        </div>
      )}
    </div>
  );
}
