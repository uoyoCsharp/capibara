import {
  House,
  ListChecks,
  Tray,
  UsersThree,
  Gear,
  CaretLeft,
  CaretRight,
  Pause,
  Play,
} from '@phosphor-icons/react';
import { useState, useEffect, useRef, useCallback } from 'react';
import type { SectionId } from '@core/shared/types';
import { useAppSnapshot } from '../../hooks-v2/use-app-snapshot';
import { useConversationStore } from '../../store-v2/conversation.store';
import { cn } from '../../lib/utils';
import { toast } from '../../store/toast.store';
import { Button } from '../../components/ui/button';
import { Separator } from '../../components/ui/separator';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = () => window.capibara as any;

interface SidebarProps {
  activeSection: SectionId;
  onNavigate: (section: SectionId) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

const NAV_ITEMS: Array<{ id: SectionId; label: string; icon: typeof House }> = [
  { id: 'dashboard', label: 'Dashboard', icon: House },
  { id: 'tasks', label: 'Tasks', icon: ListChecks },
  { id: 'inbox', label: 'Inbox', icon: Tray },
  { id: 'team', label: 'Team', icon: UsersThree },
  { id: 'settings', label: 'Settings', icon: Gear },
];

export function Sidebar({ activeSection, onNavigate, collapsed, onToggleCollapse }: SidebarProps) {
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
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeSection === item.id;
          return (
            <Button
              key={item.id}
              variant="ghost"
              onClick={() => onNavigate(item.id)}
              title={collapsed ? item.label : undefined}
              className={cn(
                'w-full h-10 relative',
                collapsed ? 'justify-center px-0' : 'justify-start gap-3',
                isActive ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent',
              )}
            >
              <Icon size={20} weight={isActive ? 'fill' : 'regular'} className="shrink-0" />
              {!collapsed && item.label}
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
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleCollapse}
          className={cn('w-full text-xs text-muted-foreground', collapsed ? 'justify-center px-0' : 'justify-start gap-2')}
        >
          {collapsed ? <CaretRight size={16} /> : <CaretLeft size={16} />}
          {!collapsed && 'Collapse'}
        </Button>
      </div>
    </aside>
  );
}

function SchedulerControlButton({ collapsed }: { collapsed: boolean }) {
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
        if (res?.ok) { setPaused(false); toast.success('Scheduler resumed'); }
      } else {
        const res = await api().pauseExecution?.();
        if (res?.ok) { setPaused(true); toast.success('Scheduler paused'); }
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [paused, loading]);

  const label = paused ? 'Resume' : 'Pause';

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
