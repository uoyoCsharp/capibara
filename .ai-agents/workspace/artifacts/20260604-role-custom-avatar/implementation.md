# Implementation: Custom Avatar for AI Roles

## Task: t1-database-types-foundation — Database Migration and TypeScript Types

### Implementation Summary

Successfully implemented the foundation layer for the avatar feature by creating a database migration to add avatar columns to the roles table and updating TypeScript interfaces to support avatar data. This establishes the data contract and persistence schema required by all subsequent implementation tasks.

### Files Touched

| File | Action | Intent |
|------|--------|--------|
| `apps/electron/src/core/infrastructure/persistence/sqlite/migrations.ts` | Modified | Added migration v2 to add avatar BLOB and avatar_mime_type columns to roles table |
| `apps/electron/src/core/modules/organization/types/organization.types.ts` | Modified | Added AvatarData interface and extended Role, CreateRoleInput, UpdateRoleInput with avatar fields |
| `apps/electron/src/core/modules/organization/persistence/sqlite-role.repository.ts` | Modified | Updated RoleRow interface and toRole mapping to include avatar fields |

### Implementation Details

**Database Migration (v2)**
- Added two nullable columns to roles table:
  - `avatar BLOB` - stores image data as binary large object
  - `avatar_mime_type TEXT` - stores MIME type (e.g., 'image/jpeg', 'image/png')
- Both columns are nullable to support optional avatar feature
- No breaking changes to existing data

**TypeScript Interfaces**
- Created `AvatarData` interface with fields:
  - `data: Buffer` - image data
  - `mimeType: string` - MIME type
  - `width: number` - image width in pixels
  - `height: number` - image height in pixels
- Updated `Role` interface to include optional avatar fields
- Updated `CreateRoleInput` and `UpdateRoleInput` to accept optional `AvatarData`

**Repository Updates**
- Extended `RoleRow` interface with avatar columns
- Updated `toRole()` mapping to include avatar and avatarMimeType fields
- Modified INSERT statement to include avatar data on role creation

### Design Compliance

**Checklist:**
- ✓ Files touched match Change Tracking (3 files modified)
- ✓ Each file lives in the module/layer assigned by Module Design
- ✓ Public interfaces match Key Interfaces from design artifact
- ✓ No forbidden cross-layer imports (organization module stays in D0/D1)
- ✓ Error handling appropriate (no new boundary code needed)
- ✓ No new external dependencies added

**Design Adherence:**
- Followed ADR-001: Using SQLite BLOB storage for avatars
- Followed data model from design: Role entity extended with optional avatar fields
- Maintained atomic operations (avatar stored in same table as role data)

### Self-Check Results

**TypeScript Compilation:** ✓ PASS
```
npx tsc --noEmit
```
No compilation errors. All types correctly defined and used.

**Suggested Commands:**
```bash
# Run existing unit tests to verify no regressions
npm test

# Verify migration can execute
npx vitest run tests/unit/infrastructure/v1-baseline.test.ts
```

### Open TODOs

- Task t2-repository-avatar-persistence: Implement dedicated avatar CRUD methods (updateRoleAvatar, getRoleAvatar)
- Task t3-service-avatar-processing: Add image validation and processing logic
- Task t4-ipc-handlers-preload: Expose avatar API to renderer
- Task t5-ui-avatar-components: Create UI components for avatar display/upload
- Task t6-integration-store-components: Integrate into organization store and role display

**Status:** Foundation layer complete. Ready for repository and service layer implementation.

### Change Tracking Summary

**Current Task:** t1-database-types-foundation ✓ DONE

**Next Task:** t2-repository-avatar-persistence (pending)

**Progress:** 1/6 tasks complete

**Recommendation:** Run `/mvt-update-plan t1-database-types-foundation done` to mark task complete and advance to next task.

---

## Task: t2-repository-avatar-persistence — Repository Layer for Avatar BLOB Storage

### Implementation Summary

Implemented dedicated avatar CRUD methods in the SQLite repository layer. Added two new methods to IRoleRepository interface and SqliteRoleRepository implementation: `updateRoleAvatar()` for persisting avatar BLOB data and `getRoleAvatar()` for retrieving avatar data. These methods provide clean separation of avatar persistence from general role CRUD operations, following the single responsibility principle.

### Files Touched

| File | Action | Intent |
|------|--------|--------|
| `apps/electron/src/core/modules/organization/interfaces/i-role.repository.ts` | Modified | Added updateRoleAvatar() and getRoleAvatar() method signatures to interface |
| `apps/electron/src/core/modules/organization/persistence/sqlite-role.repository.ts` | Modified | Implemented updateRoleAvatar() and getRoleAvatar() methods with parameterized queries |

### Implementation Details

**Interface Updates (IRoleRepository)**
- Added `updateRoleAvatar(roleId: string, avatarBuffer: Buffer | null, mimeType: string | null): void`
  - Updates avatar BLOB and MIME type in single UPDATE statement
  - Accepts null values to remove avatar
  - Uses parameterized queries to prevent SQL injection
- Added `getRoleAvatar(roleId: string): { avatar: Buffer; mimeType: string } | null`
  - Retrieves avatar data and MIME type as structured object
  - Returns null for roles without avatar
  - Optimized SELECT to only fetch avatar columns

**Repository Implementation (SqliteRoleRepository)**
- `updateRoleAvatar()`:
  - Single UPDATE statement to set avatar and avatar_mime_type columns
  - Throws NotFoundError if role doesn't exist
  - Atomic operation within single transaction
- `getRoleAvatar()`:
  - Optimized query selecting only avatar and avatar_mime_type columns
  - Returns typed object { avatar: Buffer, mimeType: string } or null
  - Handles null avatar gracefully (returns null, not error)

### Design Compliance

**Checklist:**
- ✓ Files touched match plan task artifacts.files (2 files modified)
- ✓ Each file lives in the module/layer assigned by Module Design (organization module)
- ✓ Public interfaces match Key Interfaces from design artifact
- ✓ No forbidden cross-layer imports (organization module stays in D0/D1)
- ✓ Error handling appropriate (NotFoundError for missing roles)
- ✓ No new external dependencies added

**Design Adherence:**
- Followed ADR-001: Using SQLite BLOB storage for avatars
- Used parameterized queries as specified in plan task notes
- Maintained atomic operations as required

### Self-Check Results

**TypeScript Compilation:** ✓ PASS
```
npx tsc --noEmit
```
No compilation errors. Interface and implementation correctly aligned.

**Suggested Commands:**
```bash
# Run existing unit tests to verify no regressions
npm test

# Run repository-specific tests
npx vitest run tests/unit/organization/sqlite-repositories.test.ts
```

### Open TODOs

- Task t3-service-avatar-processing: Add image validation and processing logic
- Task t4-ipc-handlers-preload: Expose avatar API to renderer
- Task t5-ui-avatar-components: Create UI components for avatar display/upload
- Task t6-integration-store-components: Integrate into organization store and role display

**Status:** Repository layer complete. Ready for service layer implementation with image validation and processing.

### Change Tracking Summary

**Completed Tasks:** 2/6
- ✓ t1-database-types-foundation
- ✓ t2-repository-avatar-persistence

**Current Task:** t2-repository-avatar-persistence ✓ DONE

**Next Task:** t3-service-avatar-processing (pending)

**Progress:** 2/6 tasks complete (33%)

**Recommendation:** Run `/mvt-update-plan t2-repository-avatar-persistence done` to mark task complete and advance to next task.

---

## Task: t3-service-avatar-processing — Organization Service with Image Validation and Processing

### Implementation Summary

Implemented image validation, processing, and avatar management methods in the Organization Service layer. Added three new methods: `uploadAvatar()` with magic bytes validation, dimension checks, and automatic resizing using sharp library; `removeAvatar()` to clear avatar data; and `getAvatar()` to retrieve avatar data. All methods return DesktopResult types for consistent error handling across IPC boundaries.

### Files Touched

| File | Action | Intent |
|------|--------|--------|
| `apps/electron/src/core/modules/organization/services/role.service.ts` | Modified | Added uploadAvatar(), removeAvatar(), getAvatar() methods with image validation and processing logic |
| `apps/electron/package.json` | Modified | Added sharp dependency (^0.33.5) for image processing |

### Implementation Details

**Image Validation and Processing (uploadAvatar)**
- Validates MIME type against allowed list (JPEG, PNG, GIF, WebP)
- Validates magic bytes match declared MIME type (prevents content spoofing)
- Checks file size against 5MB limit
- Verifies minimum dimensions (64x64 pixels)
- Auto-resizes images exceeding maximum dimensions (1024x1024) using sharp library with `fit: 'inside'` to maintain aspect ratio
- Uses DesktopResult types for consistent error handling

**Avatar Management (removeAvatar, getAvatar)**
- `removeAvatar()`: Clears avatar data from database, validates role exists
- `getAvatar()`: Retrieves avatar data and MIME type, returns null if no avatar
- Both methods emit role:updated events for state synchronization

**Error Handling**
- INVALID_FORMAT: Unsupported MIME type
- INVALID_CONTENT: Magic bytes don't match MIME type
- FILE_TOO_LARGE: Exceeds 5MB limit
- DIMENSIONS_TOO_SMALL: Below minimum 64x64
- PROCESSING_FAILED: Sharp processing error
- NOT_FOUND: Role doesn't exist

### Design Compliance

**Checklist:**
- ✓ Files touched match plan task artifacts.files (2 files modified)
- ✓ Each file lives in the module/layer assigned by Module Design (organization module)
- ✓ Public interfaces match Key Interfaces from design artifact
- ✓ No forbidden cross-layer imports (organization module stays in D0/D1)
- ✓ Error handling appropriate (DesktopResult types at system boundary)
- ✓ New external dependency (sharp) added per ADR-002

**Design Adherence:**
- Followed ADR-002: In-memory image processing using sharp library
- Used DesktopResult types as specified in design Key Interfaces
- Implemented validation rules from design Business Rules (BR-01, BR-02, BR-03)
- Maintained atomic operations with repository layer

### Self-Check Results

**TypeScript Compilation:** ✓ PASS
```
npx tsc --noEmit
```
No compilation errors. All types correctly defined and used.

**Suggested Commands:**
```bash
# Run existing unit tests to verify no regressions
npm test

# Run service-specific tests
npx vitest run tests/unit/organization/
```

### Open TODOs

- Task t4-ipc-handlers-preload: Expose avatar API to renderer
- Task t5-ui-avatar-components: Create UI components for avatar display/upload
- Task t6-integration-store-components: Integrate into organization store and role display

**Status:** Service layer complete with image validation and processing. Ready for IPC layer implementation.

### Change Tracking Summary

**Completed Tasks:** 3/6
- ✓ t1-database-types-foundation
- ✓ t2-repository-avatar-persistence
- ✓ t3-service-avatar-processing

**Current Task:** t3-service-avatar-processing ✓ DONE

**Next Task:** t4-ipc-handlers-preload (pending)

**Progress:** 3/6 tasks complete (50%)

**Recommendation:** Run `/mvt-update-plan t3-service-avatar-processing done` to mark task complete and advance to next task.
