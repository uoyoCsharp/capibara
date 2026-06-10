import { useState, useEffect, useCallback } from 'react';
import { Trash, FloppyDisk } from '@phosphor-icons/react';
import type { RoleRecord } from '@core/shared/types';
import { SkillSelector } from './SkillSelector';
import { AvatarDisplay } from './AvatarDisplay';
import { AvatarUploadDialog } from './AvatarUploadDialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
} from '../ui/sheet';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Label } from '../ui/label';
import { Checkbox } from '../ui/checkbox';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from '../ui/select';
import { useT } from '../../hooks/use-locale';

interface RoleDrawerProps {
  role: RoleRecord;
  roles: RoleRecord[];
  onUpdate: (input: unknown) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  onRefresh?: () => void;
}

export function RoleDrawer({ role, roles, onUpdate, onDelete, onClose, onRefresh }: RoleDrawerProps) {
  const t = useT();
  const [name, setName] = useState(role.name);
  const [persona, setPersona] = useState(role.persona);
  const [canApprove, setCanApprove] = useState(role.canApprove);
  const [canDelegate, setCanDelegate] = useState(role.canDelegate);
  const [requiresHumanApproval, setRequiresHumanApproval] = useState(role.requiresHumanApproval);
  const [status, setStatus] = useState(role.status);
  const [parentId, setParentId] = useState(role.parentId);
  const [skillIds, setSkillIds] = useState<string[]>(role.skillIds);
  const [knowledgeBaseRefs, setKnowledgeBaseRefs] = useState(role.knowledgeBaseRefs.join('\n'));
  const [toolPolicy, setToolPolicy] = useState(role.toolPolicy);
  const [fileAccessPaths, setFileAccessPaths] = useState(role.fileAccessPaths?.join('\n') ?? '');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [showAvatarUpload, setShowAvatarUpload] = useState(false);

  useEffect(() => {
    setName(role.name);
    setPersona(role.persona);
    setCanApprove(role.canApprove);
    setCanDelegate(role.canDelegate);
    setRequiresHumanApproval(role.requiresHumanApproval);
    setStatus(role.status);
    setParentId(role.parentId);
    setSkillIds(role.skillIds);
    setKnowledgeBaseRefs(role.knowledgeBaseRefs.join('\n'));
    setToolPolicy(role.toolPolicy);
    setFileAccessPaths(role.fileAccessPaths?.join('\n') ?? '');
    setIsDirty(false);
    setShowDeleteConfirm(false);
  }, [role]);

  const markDirty = useCallback(() => setIsDirty(true), []);

  const handleSave = () => {
    if (!name.trim()) return;
    const refs = knowledgeBaseRefs
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const parsedFileAccess = fileAccessPaths
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    onUpdate({
      id: role.id,
      name: name.trim(),
      persona,
      canApprove,
      canDelegate,
      requiresHumanApproval,
      status,
      parentId,
      skillIds,
      knowledgeBaseRefs: refs,
      toolPolicy,
      fileAccessPaths: parsedFileAccess.length > 0 ? parsedFileAccess : null,
    });
    setIsDirty(false);
  };

  const handleDelete = () => {
    const hasChildren = roles.some((r) => r.parentId === role.id);
    if (hasChildren) {
      setShowDeleteConfirm(true);
    } else {
      onDelete(role.id);
    }
  };

  const getDescendantIds = (id: string): string[] => {
    const children = roles.filter((r) => r.parentId === id);
    return [id, ...children.flatMap((c) => getDescendantIds(c.id))];
  };
  const excludeIds = new Set(getDescendantIds(role.id));
  const parentOptions = roles.filter((r) => !excludeIds.has(r.id));

  return (
    <>
      <Sheet open onOpenChange={(open) => !open && onClose()}>
        <SheetContent side="right" className="w-96 flex flex-col p-0 sm:max-w-96">
          <SheetHeader className="px-5 py-4 border-b border-border space-y-0">
            <SheetTitle className="text-base">{t.roleDrawer?.title ?? 'Edit Role'}</SheetTitle>
            <SheetDescription className="sr-only">
              {t.roleDrawer?.subtitle ?? 'Edit role details'}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-auto px-5 py-5 space-y-6">
            {/* Avatar */}
            <div>
              <Label className="text-xs uppercase tracking-wider mb-1.5">
                {t.roleDrawer?.avatarLabel ?? 'Avatar'}
              </Label>
              <div className="flex items-center gap-3">
                <AvatarDisplay
                  roleId={role.id}
                  roleName={role.name}
                  size={64}
                  className="shrink-0"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAvatarUpload(true)}
                >
                  {t.roleDrawer?.uploadAvatarButton ?? 'Upload Avatar'}
                </Button>
              </div>
            </div>

            {/* Name */}
            <div>
              <Label className="text-xs uppercase tracking-wider mb-1.5">
                {t.roleDrawer?.nameLabel ?? 'Name'}
              </Label>
              <Input
                value={name}
                onChange={(e) => { setName(e.target.value); markDirty(); }}
                maxLength={100}
              />
              {!name.trim() && (
                <p className="text-xs text-destructive mt-1">{t.roleDrawer?.nameRequired ?? 'Name is required'}</p>
              )}
            </div>

            {/* Status */}
            <div>
              <Label className="text-xs uppercase tracking-wider mb-1.5">
                {t.roleDrawer?.statusLabel ?? 'Status'}
              </Label>
              <Select
                value={status}
                onValueChange={(val) => { setStatus(val as RoleRecord['status']); markDirty(); }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{t.status?.active ?? 'Active'}</SelectItem>
                  <SelectItem value="paused">{t.status?.paused ?? 'Paused'}</SelectItem>
                  <SelectItem value="idle">{t.status?.idle ?? 'Idle'}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Parent Role */}
            <div>
              <Label className="text-xs uppercase tracking-wider mb-1.5">
                {t.roleDrawer?.parentRoleLabel ?? 'Parent Role'}
              </Label>
              <Select
                value={parentId ?? '__none__'}
                onValueChange={(val) => { setParentId(val === '__none__' ? null : val); markDirty(); }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t.roleDrawer?.noneRoot ?? 'None (Root)'}</SelectItem>
                  {parentOptions.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Persona */}
            <div>
              <Label className="text-xs uppercase tracking-wider mb-1.5">
                {t.roleDrawer?.personaLabel ?? 'Persona'}
              </Label>
              <Textarea
                className="min-h-[100px] resize-y"
                rows={5}
                value={persona}
                onChange={(e) => { setPersona(e.target.value); markDirty(); }}
                placeholder={t.roleDrawer?.personaPlaceholder ?? 'Describe the role persona...'}
              />
            </div>

            {/* Skills */}
            <div>
              <Label className="text-xs uppercase tracking-wider mb-1.5">
                {t.roleDrawer?.skillsLabel ?? 'Skills'}
              </Label>
              <SkillSelector
                selectedIds={skillIds}
                onChange={(ids) => { setSkillIds(ids); markDirty(); }}
              />
            </div>

            {/* Knowledge Base Refs */}
            <div>
              <Label className="text-xs uppercase tracking-wider mb-1.5">
                {t.roleDrawer?.knowledgeBaseLabel ?? 'Knowledge Base'}
              </Label>
              <Textarea
                className="resize-y"
                rows={3}
                value={knowledgeBaseRefs}
                onChange={(e) => { setKnowledgeBaseRefs(e.target.value); markDirty(); }}
                placeholder={t.roleDrawer?.knowledgePlaceholder ?? 'One path per line...'}
              />
            </div>

            {/* Permissions */}
            <div>
              <Label className="text-xs uppercase tracking-wider mb-2">
                {t.roleDrawer?.permissionsLabel ?? 'Permissions'}
              </Label>
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="perm-approve"
                    checked={canApprove}
                    onCheckedChange={(checked) => { setCanApprove(!!checked); markDirty(); }}
                  />
                  <Label htmlFor="perm-approve" className="text-sm font-normal text-muted-foreground">
                    {t.roleDrawer?.canApprove ?? 'Can Approve'}
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="perm-delegate"
                    checked={canDelegate}
                    onCheckedChange={(checked) => { setCanDelegate(!!checked); markDirty(); }}
                  />
                  <Label htmlFor="perm-delegate" className="text-sm font-normal text-muted-foreground">
                    {t.roleDrawer?.canDelegate ?? 'Can Delegate'}
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="perm-human"
                    checked={requiresHumanApproval}
                    onCheckedChange={(checked) => { setRequiresHumanApproval(!!checked); markDirty(); }}
                  />
                  <Label htmlFor="perm-human" className="text-sm font-normal text-muted-foreground">
                    {t.roleDrawer?.requiresHumanApproval ?? 'Requires Human Approval'}
                  </Label>
                </div>
              </div>
            </div>

            {/* Tool Policy */}
            <div>
              <Label className="text-xs uppercase tracking-wider mb-1.5">
                {t.roleDrawer?.toolPolicyLabel ?? 'Tool Policy'}
              </Label>
              <Select
                value={toolPolicy}
                onValueChange={(val) => { setToolPolicy(val as RoleRecord['toolPolicy']); markDirty(); }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="permissive">{t.roleDrawer?.toolPolicyPermissive ?? 'Permissive'}</SelectItem>
                  <SelectItem value="restrictive">{t.roleDrawer?.toolPolicyRestrictive ?? 'Restrictive'}</SelectItem>
                  <SelectItem value="ask_user">{t.roleDrawer?.toolPolicyAskUser ?? 'Ask User'}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* File Access Paths */}
            <div>
              <Label className="text-xs uppercase tracking-wider mb-1.5">
                {t.roleDrawer?.fileAccessLabel ?? 'File Access Paths'}
              </Label>
              <Textarea
                className="resize-y font-mono text-xs"
                rows={3}
                value={fileAccessPaths}
                onChange={(e) => { setFileAccessPaths(e.target.value); markDirty(); }}
                placeholder={t.roleDrawer?.fileAccessPlaceholder ?? 'One glob pattern per line...'}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {t.roleDrawer?.fileAccessHint ?? 'Leave empty to allow all paths'}
              </p>
            </div>
          </div>

          {/* Footer */}
          <SheetFooter className="flex-row items-center justify-between px-5 py-4 border-t border-border sm:justify-between sm:space-x-0">
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={handleDelete}
            >
              <Trash size={16} />
              {t.common?.delete ?? 'Delete'}
            </Button>
            <Button
              onClick={handleSave}
              disabled={!isDirty || !name.trim()}
            >
              <FloppyDisk size={16} />
              {t.common?.save ?? 'Save'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Delete confirmation */}
      <Dialog open={showDeleteConfirm} onOpenChange={(open) => !open && setShowDeleteConfirm(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t.roleDrawer?.deleteWithChildren ?? 'Delete role with children?'}</DialogTitle>
            <DialogDescription>
              {t.roleDrawer?.deleteWithChildrenMessage ?? 'This role has child roles. Deleting it will orphan them.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>
              {t.common?.cancel ?? 'Cancel'}
            </Button>
            <Button variant="destructive" onClick={() => onDelete(role.id)}>
              {t.roleDrawer?.deleteAnyway ?? 'Delete Anyway'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Avatar Upload Dialog */}
      <AvatarUploadDialog
        roleId={role.id}
        open={showAvatarUpload}
        onOpenChange={setShowAvatarUpload}
        onUploadSuccess={() => onRefresh?.()}
      />
    </>
  );
}
