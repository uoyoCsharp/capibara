import {
  House,
  TreeStructure,
  ListChecks,
  ChatCircleDots,
  Lightbulb,
  Question,
} from '@phosphor-icons/react';
import type { SectionId } from '@shared/contracts';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';

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
    <aside className="flex h-full w-[var(--sidebar-width)] flex-col border-r bg-sidebar-background">
      {/* Logo */}
      <div className="flex h-14 items-center gap-2.5 px-5 border-b">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-bold">
          C
        </div>
        <span className="text-base font-semibold text-foreground">
          Capibara
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeSection === item.id;

          return (
            <Button
              key={item.id}
              variant="ghost"
              onClick={() => onNavigate(item.id)}
              className={cn(
                'w-full justify-start gap-3 h-10',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              )}
            >
              <Icon
                size={20}
                weight={isActive ? 'fill' : 'regular'}
              />
              {item.label}
            </Button>
          );
        })}
      </nav>

      {/* Footer */}
      <Separator />
      <div className="px-3 py-2">
        <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-xs text-muted-foreground">
          <Question size={16} />
          Help & Feedback
        </Button>
      </div>
    </aside>
  );
}
