import { useState, useEffect, useCallback } from 'react';
import { Trash, FloppyDisk } from '@phosphor-icons/react';
import type { RoleRecord, UpdateRoleInput, SkillRecord } from '@shared/contracts';
import { SkillSelector } from './SkillSelector';
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
import { useT } from '../../hooks/useLocale';

interface RoleDrawerProps {
  role: RoleRecord;
  roles: RoleRecord[];
  onUpdate: (input: UpdateRoleInput) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export function RoleDrawer({ role, roles, onUpdate, onDelete, onClose }: RoleDrawerProps) {
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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  // Reset state when role changes
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
    onUpdate({
      id: role.id,
      name: name.trim(),
      persona,
      canApprove,
      canDelegate,
      requiresHumanApproval,
      status,
      skillIds,
      knowledgeBaseRefs: refs,
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

  // Exclude self and descendants from parent options
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
          {/* Header */}
          <SheetHeader className="px-5 py-4 border-b border-border space-y-0">
            <SheetTitle className="text-base">{t.roleDrawer.title}</SheetTitle>
            <SheetDescription className="sr-only">
              {t.roleDrawer.subtitle}
            </SheetDescription>
          </SheetHeader>

          {/* Body */}
          <div className="flex-1 overflow-auto px-5 py-5 space-y-6">
            {/* Name */}
            <div>
              <Label className="text-xs uppercase tracking-wider mb-1.5">
                {t.roleDrawer.nameLabel}
              </Label>
              <Input
                value={name}
                onChange={(e) => { setName(e.target.value); markDirty(); }}
                maxLength={100}
              />
              {!name.trim() && (
                <p className="text-xs text-destructive mt-1">{t.roleDrawer.nameRequired}</p>
              )}
            </div>

            {/* Status */}
            <div>
              <Label className="text-xs uppercase tracking-wider mb-1.5">
                {t.roleDrawer.statusLabel}
              </Label>
              <Select
                value={status}
                onValueChange={(val) => { setStatus(val as RoleRecord['status']); markDirty(); }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{t.status.active}</SelectItem>
                  <SelectItem value="paused">{t.status.paused}</SelectItem>
                  <SelectItem value="idle">{t.status.idle}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Parent Role */}
            <div>
              <Label className="text-xs uppercase tracking-wider mb-1.5">
                {t.roleDrawer.parentRoleLabel}
              </Label>
              <Select
                value={parentId ?? '__none__'}
                onValueChange={(val) => { setParentId(val === '__none__' ? null : val); markDirty(); }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t.roleDrawer.noneRoot}</SelectItem>
                  {parentOptions.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Persona */}
            <div>
              <Label className="text-xs uppercase tracking-wider mb-1.5">
                {t.roleDrawer.personaLabel}
              </Label>
              <Textarea
                className="min-h-[100px] resize-y"
                rows={5}
                value={persona}
                onChange={(e) => { setPersona(e.target.value); markDirty(); }}
                placeholder={t.roleDrawer.personaPlaceholder}
              />
            </div>

            {/* Skills */}
            <div>
              <Label className="text-xs uppercase tracking-wider mb-1.5">
                {t.roleDrawer.skillsLabel}
              </Label>
              <SkillSelector
                selectedIds={skillIds}
                onChange={(ids) => { setSkillIds(ids); markDirty(); }}
              />
            </div>

            {/* Knowledge Base Refs */}
            <div>
              <Label className="text-xs uppercase tracking-wider mb-1.5">
                {t.roleDrawer.knowledgeBaseLabel}
              </Label>
              <Textarea
                className="resize-y"
                rows={3}
                value={knowledgeBaseRefs}
                onChange={(e) => { setKnowledgeBaseRefs(e.target.value); markDirty(); }}
                placeholder={t.roleDrawer.knowledgePlaceholder}
              />
            </div>

            {/* Permissions */}
            <div>
              <Label className="text-xs uppercase tracking-wider mb-2">
                {t.roleDrawer.permissionsLabel}
              </Label>
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="perm-approve"
                    checked={canApprove}
                    onCheckedChange={(checked) => { setCanApprove(!!checked); markDirty(); }}
                  />
                  <Label htmlFor="perm-approve" className="text-sm font-normal text-muted-foreground">
                    {t.roleDrawer.canApprove}
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="perm-delegate"
                    checked={canDelegate}
                    onCheckedChange={(checked) => { setCanDelegate(!!checked); markDirty(); }}
                  />
                  <Label htmlFor="perm-delegate" className="text-sm font-normal text-muted-foreground">
                    {t.roleDrawer.canDelegate}
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="perm-human"
                    checked={requiresHumanApproval}
                    onCheckedChange={(checked) => { setRequiresHumanApproval(!!checked); markDirty(); }}
                  />
                  <Label htmlFor="perm-human" className="text-sm font-normal text-muted-foreground">
                    {t.roleDrawer.requiresHumanApproval}
                  </Label>
                </div>
              </div>
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
              {t.common.delete}
            </Button>
            <Button
              onClick={handleSave}
              disabled={!isDirty || !name.trim()}
            >
              <FloppyDisk size={16} />
              {t.common.save}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Delete confirmation */}
      <Dialog open={showDeleteConfirm} onOpenChange={(open) => !open && setShowDeleteConfirm(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t.roleDrawer.deleteWithChildren}</DialogTitle>
            <DialogDescription>
              {t.roleDrawer.deleteWithChildrenMessage}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>
              {t.common.cancel}
            </Button>
            <Button variant="destructive" onClick={() => onDelete(role.id)}>
              {t.roleDrawer.deleteAnyway}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
