import { UserCircle, ShieldCheck, Sparkle, UsersThree } from '@phosphor-icons/react';
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
  /** True when this card is the last child of its parent — used to draw
   *  the tree connector correctly (trunk stops at this branch). */
  isLast?: boolean;
}

function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

export function RoleCard({ node, depth, roles, onSelect, isLast = false }: RoleCardProps) {
  const t = useT();
  const parentName = node.role.parentId
    ? roles.find((r) => r.id === node.role.parentId)?.name
    : null;

  const skillCount = node.role.skillIds?.length ?? 0;
  const childCount = node.children.length;
  const isRoot = depth === 0;

  return (
    <div className="relative">
      {/* Tree connector: vertical trunk from parent + horizontal tick into card */}
      {depth > 0 && (
        <>
          <span
            aria-hidden
            className="absolute left-0 top-0 w-px bg-border"
            style={{ height: isLast ? '22px' : '100%' }}
          />
          <span
            aria-hidden
            className="absolute left-0 top-[22px] h-px w-4 bg-border"
          />
        </>
      )}

      <div style={{ paddingLeft: depth > 0 ? '20px' : '0' }}>
        <Card
          className={`group cursor-pointer p-3 transition-all hover:shadow-sm hover:border-primary/40 hover:bg-accent/30 ${
            node.role.requiresHumanApproval ? 'border-destructive/30' : ''
          }`}
          onClick={() => onSelect(node.role.id)}
        >
          <div className="flex items-center gap-3">
            <UserCircle
              size={32}
              weight="fill"
              className="shrink-0 text-muted-foreground/80 group-hover:text-primary transition-colors"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-foreground truncate">
                  {node.role.name}
                </span>
                {node.role.requiresHumanApproval && (
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1.5 py-0 h-4 gap-0.5 border-destructive/40 text-destructive"
                  >
                    <ShieldCheck size={10} weight="fill" />
                    {t.teamPage?.humanApprovalBadge ?? 'Human Approval'}
                  </Badge>
                )}
              </div>
              {!isRoot && parentName && (
                <p className="text-[11px] text-muted-foreground/80 mt-0.5 truncate">
                  {t.teamPage?.reportsTo ?? 'Reports to'} · {parentName}
                </p>
              )}
            </div>

            {/* Right-side metrics: skill + report counts */}
            <div className="shrink-0 flex items-center gap-1.5 text-muted-foreground/80">
              {skillCount > 0 && (
                <Badge
                  variant="secondary"
                  className="text-[10px] px-1.5 py-0 h-5 gap-1 font-normal"
                  title={interpolate(t.teamPage?.skillsBadge ?? '{n} skills', { n: skillCount })}
                >
                  <Sparkle size={10} weight="duotone" />
                  {skillCount}
                </Badge>
              )}
              {childCount > 0 && (
                <Badge
                  variant="secondary"
                  className="text-[10px] px-1.5 py-0 h-5 gap-1 font-normal"
                  title={interpolate(t.teamPage?.reportsBadge ?? '{n} reports', { n: childCount })}
                >
                  <UsersThree size={10} weight="duotone" />
                  {childCount}
                </Badge>
              )}
            </div>
          </div>
        </Card>
      </div>

      {node.children.length > 0 && (
        <div className="mt-1.5 space-y-1.5 pl-5 relative">
          {/* Vertical trunk for this node's children */}
          {node.children.map((child, i) => (
            <RoleCard
              key={child.role.id}
              node={child}
              depth={depth + 1}
              roles={roles}
              onSelect={onSelect}
              isLast={i === node.children.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
