import {
  House,
  ListChecks,
  Tray,
  UsersThree,
  Gear,
  CaretLeft,
  CaretRight,
  Plus,
  SignOut,
  Check,
  CaretUpDown,
} from '@phosphor-icons/react';
import { useState, useRef, useEffect, useCallback } from 'react';
import type { SectionId, OrganizationRecord } from '@shared/contracts';
import type { LocaleMessages } from '@shared/locale/types.js';
import { useCapibaraSnapshot } from '../../hooks/useCapibaraSnapshot';
import { useT } from '../../hooks/useLocale';
import { cn } from '../../lib/utils';
import { toast } from '../../store/toast.store';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import { Avatar, AvatarFallback } from '../ui/avatar';
import logoImg from '../../assets/logo.png';

interface SidebarProps {
  activeSection: SectionId;
  onNavigate: (section: SectionId) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

const NAV_ITEM_DEFS: Array<{
  id: SectionId;
  sectionKey: keyof LocaleMessages['sections'];
  icon: typeof House;
}> = [
  { id: 'dashboard', sectionKey: 'dashboard', icon: House },
  { id: 'tasks', sectionKey: 'tasks', icon: ListChecks },
  { id: 'inbox', sectionKey: 'inbox', icon: Tray },
  { id: 'team', sectionKey: 'team', icon: UsersThree },
  { id: 'settings', sectionKey: 'settings', icon: Gear },
];

export function Sidebar({ activeSection, onNavigate, collapsed, onToggleCollapse }: SidebarProps) {
  const t = useT();
  const { organizations, currentOrgId } = useCapibaraSnapshot();
  const currentOrg = organizations.find((o) => o.id === currentOrgId);

  // Inbox blocked count for badge
  const [blockedCount, setBlockedCount] = useState(0);

  const refreshBlockedCount = useCallback(async () => {
    if (!currentOrgId) { setBlockedCount(0); return; }
    try {
      const res = await window.capibara.getGroupedConversations(currentOrgId);
      if (res.ok) setBlockedCount(res.data.blocked.length);
    } catch { /* silent */ }
  }, [currentOrgId]);

  useEffect(() => {
    refreshBlockedCount();
    const interval = setInterval(refreshBlockedCount, 10_000);
    const unsub = window.capibara.subscribe((event) => {
      if (
        event.type === 'conversation:question-posted' ||
        event.type === 'conversation:resolved' ||
        event.type === 'conversation:cancelled' ||
        event.type === 'conversation:reply-posted'
      ) {
        refreshBlockedCount();
      }
    });
    return () => { clearInterval(interval); unsub(); };
  }, [refreshBlockedCount]);

  return (
    <aside
      className={cn(
        'flex h-full flex-col border-r bg-sidebar-background transition-[width] duration-200 ease-in-out',
        collapsed ? 'w-16' : 'w-[var(--sidebar-width)]',
      )}
    >
      {/* Logo — clickable to navigate to dashboard */}
      <button
        type="button"
        onClick={() => onNavigate('dashboard')}
        className={cn(
          'flex h-14 items-center gap-2.5 border-b hover:bg-sidebar-accent transition-colors',
          collapsed ? 'justify-center px-0' : 'px-5',
        )}
        title="Go to Dashboard"
      >
        <img src={logoImg} alt="Capibara" className="h-8 w-8 shrink-0 rounded-lg object-cover" />
        {!collapsed && (
          <span className="text-base font-semibold text-foreground whitespace-nowrap">
            Capibara
          </span>
        )}
      </button>

      {/* Workspace Label (non-collapsed only) */}
      {!collapsed && currentOrg && (
        <div className="px-5 py-2 border-b">
          <p className="text-[11px] font-medium uppercase text-muted-foreground/60 tracking-wider">
            Workspace
          </p>
          <p className="text-sm font-medium text-foreground truncate">{currentOrg.name}</p>
        </div>
      )}

      {/* Navigation */}
      <nav className={cn('flex-1 py-4 space-y-1.5', collapsed ? 'px-2' : 'px-3')}>
        {NAV_ITEM_DEFS.map((item) => {
          const Icon = item.icon;
          const isActive = activeSection === item.id;
          const label = t.sections[item.sectionKey];

          return (
            <Button
              key={item.id}
              variant="ghost"
              onClick={() => onNavigate(item.id)}
              title={collapsed ? label : undefined}
              className={cn(
                'w-full h-10 relative',
                collapsed ? 'justify-center px-0' : 'justify-start gap-3',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              )}
            >
              <Icon
                size={20}
                weight={isActive ? 'fill' : 'regular'}
                className="shrink-0"
              />
              {!collapsed && label}
              {item.id === 'inbox' && blockedCount > 0 && !collapsed && (
                <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold text-destructive-foreground">
                  {blockedCount}
                </span>
              )}
              {item.id === 'inbox' && blockedCount > 0 && collapsed && (
                <span className="absolute top-1 right-1 flex h-2.5 w-2.5 rounded-full bg-destructive" />
              )}
            </Button>
          );
        })}
      </nav>

      {/* Footer: Avatar Popover with Workspace Switcher */}
      <Separator />
      <div className={cn('py-2', collapsed ? 'px-2' : 'px-3')}>
        <AvatarPopover
          collapsed={collapsed}
          organizations={organizations}
          currentOrgId={currentOrgId}
          onNavigate={onNavigate}
        />
      </div>

      {/* Collapse toggle */}
      <Separator />
      <div className={cn('py-2', collapsed ? 'px-2' : 'px-3')}>
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleCollapse}
          title={collapsed ? t.common.expand : t.common.collapse}
          className={cn(
            'w-full text-xs text-muted-foreground',
            collapsed ? 'justify-center px-0' : 'justify-start gap-2',
          )}
        >
          {collapsed ? <CaretRight size={16} /> : <CaretLeft size={16} />}
          {!collapsed && t.common.collapse}
        </Button>
      </div>
    </aside>
  );
}

/* ── Avatar Popover with Workspace Switcher ────────────────────── */

function AvatarPopover({
  collapsed,
  organizations,
  currentOrgId,
  onNavigate,
}: {
  collapsed: boolean;
  organizations: OrganizationRecord[];
  currentOrgId: string | null;
  onNavigate: (section: SectionId) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const t = useT();

  // Close on click outside
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
      await window.capibara.updateSetting({ key: 'currentOrgId', value: orgId });
      // Snapshot refresh will be triggered by the event listener
    } catch {
      toast.error(t.errors.failedToUpdate);
    }
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
          {/* Workspace list */}
          <p className="px-2 py-1 text-[11px] font-medium uppercase text-muted-foreground/60 tracking-wider">
            {t.workspace.switchWorkspace}
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
            onClick={() => { setOpen(false); onNavigate('organization'); }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent transition-colors"
          >
            <Plus size={14} /> {t.workspace.createNewSpace}
          </button>

          <Separator className="my-1.5" />

          {/* User actions */}
          <button
            type="button"
            onClick={() => { setOpen(false); onNavigate('settings'); }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent transition-colors"
          >
            <Gear size={14} /> {t.workspace.userPreferences}
          </button>
        </div>
      )}
    </div>
  );
}
