import {
  House,
  TreeStructure,
  ListChecks,
  ChatCircleDots,
  Lightbulb,
  Question,
  CaretLeft,
  CaretRight,
} from '@phosphor-icons/react';
import type { SectionId } from '@shared/contracts';
import { useActiveRuns } from '../../hooks/useActiveRuns';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import logoImg from '../../assets/logo.png';

interface SidebarProps {
  activeSection: SectionId;
  onNavigate: (section: SectionId) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

const NAV_ITEMS: Array<{ id: SectionId; label: string; icon: typeof House }> = [
  { id: 'dashboard', label: 'Dashboard', icon: House },
  { id: 'organization', label: 'Organization', icon: TreeStructure },
  { id: 'skills', label: 'Skills & Knowledge', icon: Lightbulb },
  { id: 'execution', label: 'Execution', icon: ListChecks },
  { id: 'discussion', label: 'Discussions', icon: ChatCircleDots },
];

export function Sidebar({ activeSection, onNavigate, collapsed, onToggleCollapse }: SidebarProps) {
  const { count } = useActiveRuns();

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

      {/* Navigation */}
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
              {!collapsed && item.label}
              {item.id === 'execution' && count > 0 && !collapsed && (
                <span className="ml-auto flex items-center gap-1.5">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                  </span>
                  <span className="text-[10px] font-semibold text-green-600">{count}</span>
                </span>
              )}
              {item.id === 'execution' && count > 0 && collapsed && (
                <span className="absolute top-1 right-1 flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                </span>
              )}
            </Button>
          );
        })}
      </nav>

      {/* Footer */}
      <Separator />
      <div className={cn('py-2', collapsed ? 'px-2' : 'px-3')}>
        <Button
          variant="ghost"
          size="sm"
          title={collapsed ? 'Help & Feedback' : undefined}
          className={cn(
            'w-full text-xs text-muted-foreground',
            collapsed ? 'justify-center px-0' : 'justify-start gap-2',
          )}
        >
          <Question size={16} className="shrink-0" />
          {!collapsed && 'Help & Feedback'}
        </Button>
      </div>

      {/* Collapse toggle */}
      <Separator />
      <div className={cn('py-2', collapsed ? 'px-2' : 'px-3')}>
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleCollapse}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cn(
            'w-full text-xs text-muted-foreground',
            collapsed ? 'justify-center px-0' : 'justify-start gap-2',
          )}
        >
          {collapsed ? <CaretRight size={16} /> : <CaretLeft size={16} />}
          {!collapsed && 'Collapse'}
        </Button>
      </div>
    </aside>
  );
}
