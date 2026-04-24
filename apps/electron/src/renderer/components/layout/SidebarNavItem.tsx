import type { ComponentType } from 'react';
import type { IconProps } from '@phosphor-icons/react';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';

interface SidebarNavItemProps {
  icon: ComponentType<IconProps>;
  label: string;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
  badge?: number;
}

export function SidebarNavItem({
  icon: Icon, label, active, collapsed, onClick, badge,
}: SidebarNavItemProps) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={cn(
        'w-full h-10 relative',
        collapsed ? 'justify-center px-0' : 'justify-start gap-3',
        active
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'text-sidebar-foreground hover:bg-sidebar-accent',
      )}
    >
      <Icon size={20} weight={active ? 'fill' : 'regular'} className="shrink-0" />
      {!collapsed && label}
      {badge !== undefined && badge > 0 && !collapsed && (
        <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold text-destructive-foreground">
          {badge}
        </span>
      )}
      {badge !== undefined && badge > 0 && collapsed && (
        <span className="absolute top-1 right-1 flex h-2.5 w-2.5 rounded-full bg-destructive" />
      )}
    </Button>
  );
}
