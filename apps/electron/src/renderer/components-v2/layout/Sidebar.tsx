import {
  House,
  ListChecks,
  Tray,
  UsersThree,
  Gear,
  CaretLeft,
  CaretRight,
  CaretUpDown,
  Pause,
  Play,
  Plus,
  Check,
  TreeStructure,
} from '@phosphor-icons/react';
import { useState, useEffect, useRef, useCallback } from 'react';
import type { SectionId } from '@core/shared/types';
import type { LocaleMessages } from '@shared/locale/types.js';
import { useT } from '../../hooks-v2/use-locale';
import { useAppSnapshot } from '../../hooks-v2/use-app-snapshot';
import { useConversationStore } from '../../store-v2/conversation.store';
import { cn } from '../../lib/utils';
import { toast } from '../../store/toast.store';
import { Button } from '../../components/ui/button';
import { Separator } from '../../components/ui/separator';
import { Avatar, AvatarFallback } from '../../components/ui/avatar';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = () => window.capibara as any;

interface SidebarProps {
  activeSection: SectionId;
  onNavigate: (section: SectionId) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onCreateWorkspace?: () => void;
}

const NAV_ITEM_DEFS: Array<{
  id: SectionId;
  sectionKey: keyof LocaleMessages['sections'];
  icon: typeof House;
}> = [
  { id: 'dashboard', sectionKey: 'dashboard', icon: House },
  { id: 'tasks', sectionKey: 'tasks', icon: ListChecks },
  { id: 'inbox', sectionKey: 'inbox', icon: Tray },
  { id: 'planning', sectionKey: 'planning' as keyof LocaleMessages['sections'], icon: TreeStructure },
  { id: 'team', sectionKey: 'team', icon: UsersThree },
  { id: 'settings', sectionKey: 'settings', icon: Gear },
];

export function Sidebar({ activeSection, onNavigate, collapsed, onToggleCollapse, onCreateWorkspace }: SidebarProps) {
  const t = useT();
  const { organizations, currentOrgId } = useAppSnapshot();
  const currentOrg = organizations.find((o) => o.id === currentOrgId);
  const activeConversations = useConversationStore((s) => s.activeConversations);
  const loadActive = useConversationStore((s) => s.loadActiveConversations);

  useEffect(() => {
    if (currentOrgId) void loadActive(currentOrgId);
  }, [currentOrgId, loadActive]);

  const inboxCount = activeConversations.length;

  return (
    <aside className={cn(
      'flex h-full flex-col border-r bg-sidebar-background transition-[width] duration-200',
      collapsed ? 'w-16' : 'w-[var(--sidebar-width)]',
    )}>
      <button
        type="button"
        onClick={() => onNavigate(currentOrg ? 'workspace' : 'dashboard')}
        className={cn(
          'flex h-14 items-center gap-2.5 border-b hover:bg-sidebar-accent transition-colors',
          collapsed ? 'justify-center px-0' : 'px-5',
        )}
        title={currentOrg ? (t.workspacePage?.title ?? 'Workspace') : 'Capibara'}
      >
        <div className="h-8 w-8 shrink-0 rounded-lg bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">C</div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase text-muted-foreground/60 tracking-wider leading-tight">
              {currentOrg ? 'Workspace' : 'Capibara'}
            </p>
            {currentOrg && <p className="text-sm font-semibold truncate leading-tight">{currentOrg.name}</p>}
          </div>
        )}
      </button>

      <nav className={cn('flex-1 py-4 space-y-1.5', collapsed ? 'px-2' : 'px-3')}>
        {NAV_ITEM_DEFS.map((item) => {
          const Icon = item.icon;
          const isActive = activeSection === item.id;
          const label = (t.sections as Record<string, string>)?.[item.sectionKey] ?? item.sectionKey;
          return (
            <Button
              key={item.id}
              variant="ghost"
              onClick={() => onNavigate(item.id)}
              title={collapsed ? label : undefined}
              className={cn(
                'w-full h-10 relative',
                collapsed ? 'justify-center px-0' : 'justify-start gap-3',
                isActive ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent',
              )}
            >
              <Icon size={20} weight={isActive ? 'fill' : 'regular'} className="shrink-0" />
              {!collapsed && label}
              {item.id === 'inbox' && inboxCount > 0 && !collapsed && (
                <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold text-destructive-foreground">
                  {inboxCount}
                </span>
              )}
              {item.id === 'inbox' && inboxCount > 0 && collapsed && (
                <span className="absolute top-1 right-1 flex h-2.5 w-2.5 rounded-full bg-destructive" />
              )}
            </Button>
          );
        })}
      </nav>

      <Separator />
      <div className={cn('py-2', collapsed ? 'px-2' : 'px-3')}>
        <SchedulerControlButton collapsed={collapsed} />
      </div>

      <Separator />
      <div className={cn('py-2', collapsed ? 'px-2' : 'px-3')}>
        <AvatarPopover
          collapsed={collapsed}
          organizations={organizations}
          currentOrgId={currentOrgId}
          onNavigate={onNavigate}
          onCreateWorkspace={onCreateWorkspace}
        />
      </div>

      <Separator />
      <div className={cn('py-2', collapsed ? 'px-2' : 'px-3')}>
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleCollapse}
          title={collapsed ? (t.common?.expand ?? 'Expand') : (t.common?.collapse ?? 'Collapse')}
          className={cn('w-full text-xs text-muted-foreground', collapsed ? 'justify-center px-0' : 'justify-start gap-2')}
        >
          {collapsed ? <CaretRight size={16} /> : <CaretLeft size={16} />}
          {!collapsed && (t.common?.collapse ?? 'Collapse')}
        </Button>
      </div>
    </aside>
  );
}

function AvatarPopover({
  collapsed, organizations, currentOrgId, onNavigate, onCreateWorkspace,
}: {
  collapsed: boolean;
  organizations: Array<{ id: string; name: string }>;
  currentOrgId: string | null;
  onNavigate: (section: SectionId) => void;
  onCreateWorkspace?: () => void;
}) {
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
      await api().setSetting?.('currentOrgId', orgId);
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

function SchedulerControlButton({ collapsed }: { collapsed: boolean }) {
  const t = useT();
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(false);
  const calledRef = useRef(false);

  useEffect(() => {
    if (!calledRef.current) {
      calledRef.current = true;
      api().getExecutionState?.().then((res: { ok: boolean; data?: { paused: boolean } }) => {
        if (res?.ok) setPaused(res.data?.paused ?? false);
      }).catch(() => {});
    }

    if (typeof api()?.subscribe !== 'function') return;
    const unsub = api().subscribe((event: { type: string }) => {
      if (event.type === 'scheduler:paused') setPaused(true);
      if (event.type === 'scheduler:resumed') setPaused(false);
    });
    return unsub;
  }, []);

  const handleToggle = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      if (paused) {
        const res = await api().resumeExecution?.();
        if (res?.ok) { setPaused(false); toast.success(t.executionControl?.resumedToast ?? 'Scheduler resumed'); }
      } else {
        const res = await api().pauseExecution?.();
        if (res?.ok) { setPaused(true); toast.success(t.executionControl?.pausedToast ?? 'Scheduler paused'); }
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [paused, loading, t]);

  const label = paused
    ? (t.executionControl?.resumeAll ?? 'Resume')
    : (t.executionControl?.pauseAll ?? 'Pause');

  return (
    <Button
      variant={paused ? 'outline' : 'ghost'}
      size="sm"
      onClick={handleToggle}
      disabled={loading}
      title={collapsed ? label : undefined}
      className={cn(
        'w-full text-xs',
        collapsed ? 'justify-center px-0' : 'justify-start gap-2',
        paused && 'border-amber-500/50 text-amber-600',
      )}
    >
      {paused ? <Play size={16} weight="fill" className="shrink-0" /> : <Pause size={16} className="shrink-0" />}
      {!collapsed && label}
      {collapsed && paused && <span className="absolute top-1 right-1 flex h-2.5 w-2.5 rounded-full bg-amber-500 animate-pulse" />}
    </Button>
  );
}
