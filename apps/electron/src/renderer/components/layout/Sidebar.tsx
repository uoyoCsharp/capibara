import {
  House,
  TreeStructure,
  ListChecks,
  ChatCircleDots,
  Lightbulb,
} from '@phosphor-icons/react';
import type { SectionId } from '@shared/contracts';
import { clsx } from 'clsx';

interface SidebarProps {
  activeSection: SectionId;
  onNavigate: (section: SectionId) => void;
}

const NAV_ITEMS: Array<{ id: SectionId; label: string; icon: typeof House }> = [
  { id: 'dashboard', label: 'Dashboard', icon: House },
  { id: 'organization', label: 'Organization', icon: TreeStructure },
  { id: 'skills', label: 'Skills & Knowledge', icon: Lightbulb },
  { id: 'execution', label: 'Execution', icon: ListChecks },
  { id: 'discussion', label: 'Discussions', icon: ChatCircleDots },
];

export function Sidebar({ activeSection, onNavigate }: SidebarProps) {
  return (
    <aside className="flex h-full w-[var(--sidebar-width)] flex-col border-r border-border-default bg-[var(--sidebar-bg)]">
      {/* Logo */}
      <div className="flex h-14 items-center gap-2.5 px-5 border-b border-border-subtle">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-text-inverse text-sm font-bold">
          C
        </div>
        <span className="text-base font-semibold text-text-primary">Capibara</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeSection === item.id;

          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={clsx(
                'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-[var(--sidebar-item-active-bg)] text-[var(--sidebar-item-active-text)]'
                  : 'text-text-secondary hover:bg-[var(--sidebar-item-hover)] hover:text-text-primary',
              )}
            >
              <Icon
                size={20}
                weight={isActive ? 'fill' : 'regular'}
                className={isActive ? 'text-accent' : 'text-text-muted'}
              />
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-border-subtle px-5 py-3">
        <p className="text-xs text-text-muted">v0.1.0</p>
      </div>
    </aside>
  );
}
