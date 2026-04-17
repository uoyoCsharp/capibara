export type OrgStatus = 'active' | 'paused' | 'archived';
export type RoleStatus = 'active' | 'paused' | 'idle';
export type SkillCategory = 'analysis' | 'design' | 'implementation' | 'review' | 'test' | 'general';
export type SkillSource = 'builtin' | 'template' | 'custom';

export interface Organization {
  id: string;
  name: string;
  description: string;
  customInstructions: string;
  status: OrgStatus;
  budgetLimit: number;
  orgTemplateId: string | null;
  planningRoleId: string | null;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
}

export interface Role {
  id: string;
  orgId: string;
  name: string;
  parentId: string | null;
  persona: string;
  knowledgeBaseRefs: string[];
  skillIds: string[];
  canApprove: boolean;
  canDelegate: boolean;
  requiresHumanApproval: boolean;
  consecutiveWakeCount: number;
  isSystemRole: boolean;
  status: RoleStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Skill {
  id: string;
  name: string;
  command: string;
  description: string;
  category: SkillCategory;
  source: SkillSource;
  orgTemplateId: string | null;
  customPromptContent: string | null;
  createdAt: string;
}

export interface CreateOrganizationInput {
  name: string;
  description: string;
  customInstructions: string;
  budgetLimit: number;
  orgTemplateId: string | null;
  workspacePath: string;
}

export interface UpdateOrganizationInput {
  id: string;
  name?: string;
  description?: string;
  customInstructions?: string;
  status?: OrgStatus;
  budgetLimit?: number;
  workspacePath?: string;
  planningRoleId?: string | null;
}

export interface CreateRoleInput {
  orgId: string;
  name: string;
  parentId: string | null;
  persona: string;
  knowledgeBaseRefs: string[];
  skillIds: string[];
  canApprove: boolean;
  canDelegate: boolean;
  requiresHumanApproval: boolean;
  isSystemRole?: boolean;
}

export interface UpdateRoleInput {
  id: string;
  name?: string;
  persona?: string;
  knowledgeBaseRefs?: string[];
  skillIds?: string[];
  canApprove?: boolean;
  canDelegate?: boolean;
  requiresHumanApproval?: boolean;
  consecutiveWakeCount?: number;
  status?: RoleStatus;
}

export interface CreateSkillInput {
  name: string;
  command: string;
  description: string;
  category: SkillCategory;
  source: SkillSource;
  orgTemplateId: string | null;
  customPromptContent: string | null;
}

export interface TemplateRoleDefinition {
  name: string;
  persona: string;
  skillCommands: string[];
  knowledgeBaseRefs: string[];
  canApprove: boolean;
  canDelegate: boolean;
  requiresHumanApproval: boolean;
  children: TemplateRoleDefinition[];
}

export interface OrgTemplate {
  id: string;
  name: string;
  description: string;
  planningRole?: { roleRef: string };
  rootRoles: TemplateRoleDefinition[];
}
