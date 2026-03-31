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
    <aside className="flex h-full w-56 flex-col border-r border-gray-200 bg-white">
      {/* Logo */}
      <div className="flex h-14 items-center gap-2 px-5 border-b border-gray-100">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white text-sm font-bold">
          C
        </div>
        <span className="text-base font-semibold text-gray-900">Capibara</span>
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
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
              )}
            >
              <Icon
                size={20}
                weight={isActive ? 'fill' : 'regular'}
                className={isActive ? 'text-indigo-600' : 'text-gray-400'}
              />
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-gray-100 px-5 py-3">
        <p className="text-xs text-gray-400">v0.1.0</p>
      </div>
    </aside>
  );
}
