import {
  House,
  ListChecks,
  Tray,
  UsersThree,
  Gear,
  CaretLeft,
  CaretRight,
  TreeStructure,
} from '@phosphor-icons/react';
import { useEffect } from 'react';
import type { SectionId } from '@core/shared/types';
import type { LocaleMessages } from '@shared/locale/types.js';
import { useT } from '../../hooks/use-locale';
import { useAppStore } from '../../store/app.store';
import { useConversationStore } from '../../store/conversation.store';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import { SidebarNavItem } from './SidebarNavItem';
import { AvatarPopover } from './AvatarPopover';
import { SchedulerControlButton } from './SchedulerControlButton';

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

export function Sidebar({
  activeSection, onNavigate, collapsed, onToggleCollapse, onCreateWorkspace,
}: SidebarProps) {
  const t = useT();
  const organizations = useAppStore((s) => s.organizations);
  const currentOrgId = useAppStore((s) => s.currentOrgId);
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
      <WorkspaceHeader collapsed={collapsed} currentOrg={currentOrg ?? null} onNavigate={onNavigate} />

      <nav className={cn('flex-1 py-4 space-y-1.5', collapsed ? 'px-2' : 'px-3')}>
        {NAV_ITEM_DEFS.map((item) => {
          const label = (t.sections as Record<string, string>)?.[item.sectionKey] ?? item.sectionKey;
          const badge = item.id === 'inbox' ? inboxCount : undefined;
          return (
            <SidebarNavItem
              key={item.id}
              icon={item.icon}
              label={label}
              active={activeSection === item.id}
              collapsed={collapsed}
              onClick={() => onNavigate(item.id)}
              badge={badge}
            />
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
        <CollapseToggle collapsed={collapsed} onToggleCollapse={onToggleCollapse} />
      </div>
    </aside>
  );
}

function WorkspaceHeader({
  collapsed, currentOrg, onNavigate,
}: {
  collapsed: boolean;
  currentOrg: { id: string; name: string } | null;
  onNavigate: (section: SectionId) => void;
}) {
  const t = useT();
  return (
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
  );
}

function CollapseToggle({
  collapsed, onToggleCollapse,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const t = useT();
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onToggleCollapse}
      title={collapsed ? (t.common?.expand ?? 'Expand') : (t.common?.collapse ?? 'Collapse')}
      className={cn(
        'w-full text-xs text-muted-foreground',
        collapsed ? 'justify-center px-0' : 'justify-start gap-2',
      )}
    >
      {collapsed ? <CaretRight size={16} /> : <CaretLeft size={16} />}
      {!collapsed && (t.common?.collapse ?? 'Collapse')}
    </Button>
  );
}
