import {
  House,
  TreeStructure,
  ListChecks,
  ChatCircleDots,
  Lightbulb,
  Question,
  CaretLeft,
  CaretRight,
  Chats,
} from '@phosphor-icons/react';
import type { SectionId } from '@shared/contracts';
import type { LocaleMessages } from '@shared/locale/types.js';
import { useActiveRuns } from '../../hooks/useActiveRuns';
import { useT } from '../../hooks/useLocale';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import { LanguageSelector } from './LanguageSelector';
import logoImg from '../../assets/logo.png';

interface SidebarProps {
  activeSection: SectionId;
  onNavigate: (section: SectionId) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

const NAV_ITEM_DEFS: Array<{ id: SectionId; sectionKey: keyof LocaleMessages['sections']; icon: typeof House }> = [
  { id: 'dashboard', sectionKey: 'dashboard', icon: House },
  { id: 'organization', sectionKey: 'organization', icon: TreeStructure },
  { id: 'skills', sectionKey: 'skills', icon: Lightbulb },
  { id: 'execution', sectionKey: 'execution', icon: ListChecks },
  { id: 'discussion', sectionKey: 'discussion', icon: ChatCircleDots },
  { id: 'conversations', sectionKey: 'conversations', icon: Chats },
];

export function Sidebar({ activeSection, onNavigate, collapsed, onToggleCollapse }: SidebarProps) {
  const { count } = useActiveRuns();
  const t = useT();

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
      <div className={cn('py-2 space-y-1', collapsed ? 'px-2' : 'px-3')}>
        <LanguageSelector collapsed={collapsed} />
        <Button
          variant="ghost"
          size="sm"
          title={collapsed ? t.common.help : undefined}
          className={cn(
            'w-full text-xs text-muted-foreground',
            collapsed ? 'justify-center px-0' : 'justify-start gap-2',
          )}
        >
          <Question size={16} className="shrink-0" />
          {!collapsed && t.common.help}
        </Button>
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
