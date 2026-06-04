export type OrgStatus = 'active' | 'paused' | 'archived';
export type RoleStatus = 'active' | 'paused' | 'idle';
export type ToolPolicyMode = 'permissive' | 'restrictive' | 'ask_user';
export type SkillCategory = 'analysis' | 'design' | 'implementation' | 'review' | 'test' | 'general';
export type SkillSource = 'builtin' | 'template' | 'custom';

export interface AvatarData {
  /** Avatar image data as Buffer */
  data: Buffer;
  /** MIME type (e.g., 'image/jpeg', 'image/png') */
  mimeType: string;
  /** Image width in pixels */
  width: number;
  /** Image height in pixels */
  height: number;
}

export interface Organization {
  id: string;
  name: string;
  description: string;
  customInstructions: string;
  status: OrgStatus;
  autoStartOnCreate: boolean;
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
  fileAccessPaths: string[] | null;
  toolPolicy: ToolPolicyMode;
  /** Optional avatar BLOB data */
  avatar: Buffer | null;
  /** Optional avatar MIME type */
  avatarMimeType: string | null;
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
  orgTemplateId: string | null;
  workspacePath: string;
}

export interface UpdateOrganizationInput {
  id: string;
  name?: string;
  description?: string;
  customInstructions?: string;
  status?: OrgStatus;
  autoStartOnCreate?: boolean;
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
  avatar?: AvatarData | null;
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
  fileAccessPaths?: string[] | null;
  toolPolicy?: ToolPolicyMode;
  avatar?: AvatarData | null;
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
  /** Short one-line hook shown on template cards. Localized. */
  summary: import('@shared/locale/types').LocalizedText;
  /** Long-form description shown in the info dialog. Localized. */
  description: import('@shared/locale/types').LocalizedText;
  planningRole?: { roleRef: string };
  rootRoles: TemplateRoleDefinition[];
}
