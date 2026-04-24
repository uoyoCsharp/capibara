import { UserCircle, ShieldCheck, CaretRight } from '@phosphor-icons/react';
import type { RoleRecord } from '@core/shared/types';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { useT } from '../../hooks/use-locale';
import type { TreeNode } from './role-tree';

interface RoleCardProps {
  node: TreeNode;
  depth: number;
  roles: RoleRecord[];
  onSelect: (id: string) => void;
}

export function RoleCard({ node, depth, roles, onSelect }: RoleCardProps) {
  const t = useT();
  const parentName = node.role.parentId
    ? roles.find((r) => r.id === node.role.parentId)?.name
    : null;

  return (
    <div style={{ marginLeft: `${depth * 32}px` }}>
      {depth > 0 && (
        <div className="flex items-center gap-1 ml-2 mb-0.5 text-muted-foreground/40">
          <CaretRight size={10} />
          <div className="h-px w-4 bg-border" />
        </div>
      )}
      <Card
        className={`group cursor-pointer p-4 transition-all hover:shadow-md hover:ring-1 hover:ring-primary/30 ${
          node.role.requiresHumanApproval ? 'border-destructive/40' : ''
        }`}
        onClick={() => onSelect(node.role.id)}
      >
        <div className="flex items-start gap-3">
          <UserCircle
            size={36}
            weight="fill"
            className="flex-shrink-0 text-muted-foreground group-hover:text-primary transition-colors"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-foreground truncate">
                {node.role.name}
              </span>
              {node.role.requiresHumanApproval && (
                <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4 gap-0.5">
                  <ShieldCheck size={10} />
                  {t.teamPage?.humanApprovalBadge ?? 'Human Approval'}
                </Badge>
              )}
            </div>
            {parentName && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {t.teamPage?.reportsTo ?? 'Reports to'}: {parentName}
              </p>
            )}
            {node.role.persona && (
              <p className="text-xs text-muted-foreground/70 mt-1 line-clamp-2">
                {node.role.persona.slice(0, 120)}
              </p>
            )}
          </div>
        </div>
      </Card>

      {node.children.length > 0 && (
        <div className="mt-2 space-y-2">
          {node.children.map((child) => (
            <RoleCard
              key={child.role.id}
              node={child}
              depth={depth + 1}
              roles={roles}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
