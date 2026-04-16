import type { WorkItemTypeDefinition } from '@main/core/types/workflow-schema.types.js';

/**
 * Format an organization roles list with optional skill descriptions.
 */
export function formatOrgRoles(
  roles: Array<{ id: string; name: string; skillDescriptions: string[] }>,
  header?: string,
): string {
  if (!roles || roles.length === 0) return '';
  const lines: string[] = [header ?? '## Available Roles for Task Assignment'];
  for (const r of roles) {
    const skills = r.skillDescriptions.length > 0
      ? ` — Skills: ${r.skillDescriptions.join(', ')}`
      : '';
    lines.push(`- ${r.name} (roleId: ${r.id})${skills}`);
  }
  return lines.join('\n');
}

/**
 * Format a communication language instruction line.
 */
export function formatLanguageInstruction(lang?: string): string {
  if (!lang) return '';
  const langName = lang.startsWith('zh') ? 'Chinese (中文)' : 'English';
  return `Respond in ${langName}. Task titles and descriptions in the final plan should be in English regardless of conversation language.`;
}

/**
 * Build a Work Item Type Schema section from workflow type definitions.
 * Includes a table of all types and a visual hierarchy tree.
 */
export function formatTypeSchema(
  allTypes: WorkItemTypeDefinition[] | undefined,
  currentTypeDef?: WorkItemTypeDefinition | null,
): string {
  if (!allTypes || allTypes.length === 0) return '';

  const lines: string[] = [
    '## Work Item Type Schema',
    'This organization uses the following work item types:',
    '',
    '| Type | Label | Can Decompose | Is Leaf | Allowed Children |',
    '|------|-------|:------------:|:-------:|------------------|',
  ];

  for (const t of allTypes) {
    const children = t.allowedChildren.length > 0
      ? t.allowedChildren.join(', ')
      : '—';
    lines.push(
      `| ${t.name} | ${t.label} | ${t.canDecompose ? 'Yes' : 'No'} | ${t.isLeaf ? 'Yes' : 'No'} | ${children} |`,
    );
  }

  // Generate hierarchy tree
  const roots = allTypes.filter(t => t.allowedAtRoot);
  if (roots.length > 0) {
    lines.push('');
    lines.push('**Type hierarchy** (root-level entry points marked with *):');
    const visited = new Set<string>();
    for (const root of roots) {
      appendHierarchyTree(lines, root, allTypes, 0, visited);
    }
  }

  // Current task type position
  if (currentTypeDef) {
    lines.push('');
    lines.push(`Your current task type is **${currentTypeDef.label}** (\`${currentTypeDef.name}\`).`);
    if (currentTypeDef.canDecompose && currentTypeDef.allowedChildren.length > 0) {
      lines.push(`You can decompose it into: ${currentTypeDef.allowedChildren.join(', ')}.`);
    }
    if (currentTypeDef.isLeaf) {
      lines.push('This is a leaf type — it should be executed directly, not decomposed.');
    }
  }

  return lines.join('\n');
}

function appendHierarchyTree(
  lines: string[],
  typeDef: WorkItemTypeDefinition,
  allTypes: WorkItemTypeDefinition[],
  depth: number,
  visited: Set<string>,
): void {
  if (depth > 5 || visited.has(typeDef.name)) return;
  visited.add(typeDef.name);

  const indent = '  '.repeat(depth);
  const marker = typeDef.allowedAtRoot ? '*' : '';
  const leafTag = typeDef.isLeaf ? ' [leaf]' : '';
  lines.push(`${indent}- ${typeDef.label} (${typeDef.name})${marker}${leafTag}`);

  for (const childName of typeDef.allowedChildren) {
    const childDef = allTypes.find(t => t.name === childName);
    if (childDef) {
      appendHierarchyTree(lines, childDef, allTypes, depth + 1, visited);
    }
  }

  visited.delete(typeDef.name);
}
