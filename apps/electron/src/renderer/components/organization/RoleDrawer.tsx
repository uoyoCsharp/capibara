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

interface RoleDrawerProps {
  role: RoleRecord;
  roles: RoleRecord[];
  onUpdate: (input: UpdateRoleInput) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export function RoleDrawer({ role, roles, onUpdate, onDelete, onClose }: RoleDrawerProps) {
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
            <SheetTitle className="text-base">Configure Role</SheetTitle>
            <SheetDescription className="sr-only">
              Edit role configuration and permissions
            </SheetDescription>
          </SheetHeader>

          {/* Body */}
          <div className="flex-1 overflow-auto px-5 py-5 space-y-6">
            {/* Name */}
            <div>
              <Label className="text-xs uppercase tracking-wider mb-1.5">
                Name
              </Label>
              <Input
                value={name}
                onChange={(e) => { setName(e.target.value); markDirty(); }}
                maxLength={100}
              />
              {!name.trim() && (
                <p className="text-xs text-destructive mt-1">Name is required</p>
              )}
            </div>

            {/* Status */}
            <div>
              <Label className="text-xs uppercase tracking-wider mb-1.5">
                Status
              </Label>
              <Select
                value={status}
                onValueChange={(val) => { setStatus(val as RoleRecord['status']); markDirty(); }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="paused">Paused</SelectItem>
                  <SelectItem value="idle">Idle</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Parent Role */}
            <div>
              <Label className="text-xs uppercase tracking-wider mb-1.5">
                Parent Role
              </Label>
              <Select
                value={parentId ?? '__none__'}
                onValueChange={(val) => { setParentId(val === '__none__' ? null : val); markDirty(); }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None (Root)</SelectItem>
                  {parentOptions.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Persona */}
            <div>
              <Label className="text-xs uppercase tracking-wider mb-1.5">
                Persona
              </Label>
              <Textarea
                className="min-h-[100px] resize-y"
                rows={5}
                value={persona}
                onChange={(e) => { setPersona(e.target.value); markDirty(); }}
                placeholder="Describe the role's persona, responsibilities, and behavior..."
              />
            </div>

            {/* Skills */}
            <div>
              <Label className="text-xs uppercase tracking-wider mb-1.5">
                Skills
              </Label>
              <SkillSelector
                selectedIds={skillIds}
                onChange={(ids) => { setSkillIds(ids); markDirty(); }}
              />
            </div>

            {/* Knowledge Base Refs */}
            <div>
              <Label className="text-xs uppercase tracking-wider mb-1.5">
                Knowledge Base References
              </Label>
              <Textarea
                className="resize-y"
                rows={3}
                value={knowledgeBaseRefs}
                onChange={(e) => { setKnowledgeBaseRefs(e.target.value); markDirty(); }}
                placeholder="One reference per line..."
              />
            </div>

            {/* Permissions */}
            <div>
              <Label className="text-xs uppercase tracking-wider mb-2">
                Permissions
              </Label>
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="perm-approve"
                    checked={canApprove}
                    onCheckedChange={(checked) => { setCanApprove(!!checked); markDirty(); }}
                  />
                  <Label htmlFor="perm-approve" className="text-sm font-normal text-muted-foreground">
                    Can Approve
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="perm-delegate"
                    checked={canDelegate}
                    onCheckedChange={(checked) => { setCanDelegate(!!checked); markDirty(); }}
                  />
                  <Label htmlFor="perm-delegate" className="text-sm font-normal text-muted-foreground">
                    Can Delegate
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="perm-human"
                    checked={requiresHumanApproval}
                    onCheckedChange={(checked) => { setRequiresHumanApproval(!!checked); markDirty(); }}
                  />
                  <Label htmlFor="perm-human" className="text-sm font-normal text-muted-foreground">
                    Requires Human Approval
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
              Delete
            </Button>
            <Button
              onClick={handleSave}
              disabled={!isDirty || !name.trim()}
            >
              <FloppyDisk size={16} />
              Save
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Delete confirmation */}
      <Dialog open={showDeleteConfirm} onOpenChange={(open) => !open && setShowDeleteConfirm(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Role with Children?</DialogTitle>
            <DialogDescription>
              This role has child roles. They will become orphaned (moved to root level) after deletion.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => onDelete(role.id)}>
              Delete Anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
