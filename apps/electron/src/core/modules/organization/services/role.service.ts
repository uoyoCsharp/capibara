import { injectable } from 'tsyringe';
import type { IRoleQueryService } from '../interfaces/i-role-query.service';
import type { IRoleRepository } from '../interfaces/i-role.repository';
import type { IEventPublisher } from '@core/foundation/interfaces/i-event-publisher';
import type { DomainEventMap, DomainEventType } from '@core/foundation/events';
import type { Role, CreateRoleInput, UpdateRoleInput } from '../types/organization.types';
import type { DesktopResult } from '@core/shared/types';

const AVATAR_MIN_DIMENSION = 64;
const AVATAR_MAX_DIMENSION = 1024;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

const MAGIC_BYTES: Record<string, number[]> = {
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47],
  'image/gif': [0x47, 0x49, 0x46, 0x38],
  'image/webp': [0x52, 0x49, 0x46, 0x46],
};

function validateMagicBytes(buffer: Buffer, mimeType: string): boolean {
  const expected = MAGIC_BYTES[mimeType];
  if (!expected) return false;
  if (buffer.length < expected.length) return false;
  return expected.every((byte, index) => buffer[index] === byte);
}

@injectable()
export class RoleService implements IRoleQueryService {
  constructor(
    private readonly roleRepo: IRoleRepository,
    private readonly eventPublisher: IEventPublisher,
  ) { }

  findById(id: string): Role | null {
    return this.roleRepo.findById(id);
  }

  findByOrgId(orgId: string): Role[] {
    return this.roleRepo.findByOrgId(orgId);
  }

  findChildren(parentId: string): Role[] {
    return this.roleRepo.findChildren(parentId);
  }

  getParent(roleId: string): Role | null {
    const role = this.roleRepo.findById(roleId);
    if (!role?.parentId) return null;
    return this.roleRepo.findById(role.parentId);
  }

  getAncestors(roleId: string): Role[] {
    const ancestors: Role[] = [];
    let current = this.roleRepo.findById(roleId);
    while (current?.parentId) {
      const parent = this.roleRepo.findById(current.parentId);
      if (!parent) break;
      ancestors.push(parent);
      current = parent;
    }
    return ancestors;
  }

  create(input: CreateRoleInput): Role {
    const role = this.roleRepo.create(input);
    this.emitEvent('role:created', { roleId: role.id, orgId: role.orgId, name: role.name });
    return role;
  }

  update(input: UpdateRoleInput): Role {
    const role = this.roleRepo.update(input);
    this.emitEvent('role:updated', { roleId: role.id, orgId: role.orgId });
    return role;
  }

  delete(id: string): void {
    const role = this.roleRepo.findById(id);
    this.roleRepo.delete(id);
    if (role) {
      this.emitEvent('role:deleted', { roleId: id, orgId: role.orgId });
    }
  }

  async uploadAvatar(
    roleId: string,
    imageBuffer: Buffer,
    mimeType: string,
  ): Promise<DesktopResult<{ width: number; height: number }>> {
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return { ok: false, error: { code: 'INVALID_FORMAT', message: 'Unsupported image format' } };
    }

    if (!validateMagicBytes(imageBuffer, mimeType)) {
      return { ok: false, error: { code: 'INVALID_CONTENT', message: 'File content does not match MIME type' } };
    }

    if (imageBuffer.length > MAX_FILE_SIZE) {
      return { ok: false, error: { code: 'FILE_TOO_LARGE', message: 'Image exceeds 5MB limit' } };
    }

    const role = this.roleRepo.findById(roleId);
    if (!role) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Role not found' } };
    }

    // Process image with sharp (resize if needed)
    let processedBuffer: Buffer;
    let width: number;
    let height: number;

    try {
      const sharp = (await import('sharp')).default;
      const metadata = await sharp(imageBuffer).metadata();
      width = metadata.width ?? 0;
      height = metadata.height ?? 0;

      if (width < AVATAR_MIN_DIMENSION || height < AVATAR_MIN_DIMENSION) {
        return { ok: false, error: { code: 'DIMENSIONS_TOO_SMALL', message: `Image must be at least ${AVATAR_MIN_DIMENSION}x${AVATAR_MIN_DIMENSION}` } };
      }

      if (width > AVATAR_MAX_DIMENSION || height > AVATAR_MAX_DIMENSION) {
        // Auto-resize to fit within bounds
        const resized = await sharp(imageBuffer)
          .resize(AVATAR_MAX_DIMENSION, AVATAR_MAX_DIMENSION, { fit: 'inside' })
          .toBuffer();
        processedBuffer = resized;
        const resizedMetadata = await sharp(resized).metadata();
        width = resizedMetadata.width ?? width;
        height = resizedMetadata.height ?? height;
      } else {
        processedBuffer = imageBuffer;
      }
    } catch (error) {
      return { ok: false, error: { code: 'PROCESSING_FAILED', message: 'Failed to process image' } };
    }

    this.roleRepo.updateRoleAvatar(roleId, processedBuffer, mimeType);
    this.emitEvent('role:updated', { roleId, orgId: role.orgId });
    return { ok: true, data: { width, height } };
  }

  removeAvatar(roleId: string): DesktopResult<void> {
    const role = this.roleRepo.findById(roleId);
    if (!role) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Role not found' } };
    }

    this.roleRepo.updateRoleAvatar(roleId, null, null);
    this.emitEvent('role:updated', { roleId, orgId: role.orgId });
    return { ok: true, data: undefined };
  }

  getAvatar(roleId: string): DesktopResult<{ avatar: Buffer; mimeType: string } | null> {
    const role = this.roleRepo.findById(roleId);
    if (!role) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Role not found' } };
    }

    const avatarData = this.roleRepo.getRoleAvatar(roleId);
    return { ok: true, data: avatarData };
  }

  private emitEvent<T extends DomainEventType>(type: T, payload: DomainEventMap[T]): void {
    this.eventPublisher.publish(type, payload);
  }
}
