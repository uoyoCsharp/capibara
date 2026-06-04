# Requirements Analysis: Custom Avatar for AI Roles

## Feature Overview

Add custom avatar support to the Role entity in Capibara, enabling users to personalize their AI agent team members with unique visual identities. The feature will allow users to upload or assign avatars to roles and display them throughout the UI (team views, conversation interfaces, task assignments).

**Current State**: The Role entity has no visual identifier properties. Roles are represented by name and persona text only, with no graphical representation.

**Desired State**: Each role can optionally have a custom avatar that is displayed in all UI contexts where the role appears.

## Actors

| Actor | Role | Interaction |
|-------|------|-----------|
| **User (Admin/Manager)** | Primary actor | Uploads, manages, and deletes role avatars through the team settings interface |
| **User (Viewer)** | Secondary actor | Views role avatars in read-only contexts (task lists, conversation threads) |
| **AI Role** | Passive actor | Role's avatar is displayed when the role is referenced in UI |
| **System** | Support actor | Stores avatar files, manages file lifecycle, applies default avatars when none provided |

## Requirements

### Functional Requirements

**FR-01: Avatar Upload**
- Users can upload an image file as the avatar for a role during role creation or update
- System accepts common image formats (JPEG, PNG, GIF, WebP)
- System provides visual feedback during upload process
- System validates file before accepting

**FR-02: Avatar Display**
- Avatars are displayed in all role references across the application:
  - Team/organization overview
  - Task assignment view
  - Conversation threads
  - Run logs and execution history
- Avatars render at appropriate sizes based on context (thumbnail, full-size)
- Consistent aspect ratio maintained (square with rounded corners)

**FR-03: Avatar Management**
- Users can replace an existing avatar with a new one
- Users can remove an avatar (reverts to default)
- Users can view current avatar before replacing/removing
- System prompts for confirmation before destructive operations

**FR-04: Default Avatar**
- System displays a generated/default avatar for roles without custom avatars
- Default avatar is visually distinct from custom avatars
- Default avatar uses role name initials or generic icon

**FR-05: File Handling**
- System stores uploaded files securely in designated storage location
- System generates unique filenames to prevent conflicts
- System cleans up old files when avatars are replaced or deleted
- System handles concurrent access safely

### Non-Functional Requirements

**NFR-01: Performance**
- Avatar uploads complete within 2 seconds for files up to 5MB
- Avatar display loads within 100ms from cache
- File storage doesn't impact database performance

**NFR-02: Security**
- Uploaded files are validated to prevent malicious content
- File paths are sanitized to prevent directory traversal
- File access permissions follow role-based access control

**NFR-03: Storage Efficiency**
- System compresses images to reduce storage footprint
- Duplicate detection prevents storing identical avatars
- Old avatar files are cleaned up after replacement

**NFR-04: User Experience**
- Upload interface is intuitive and provides clear feedback
- Error messages are helpful and actionable
- Interface works across desktop and web views (if applicable)

## Domain Concepts

### New/Modified Entities

| Concept | Type | Location | Description |
|---------|------|----------|-------------|
| **Avatar** | New entity/value object | Organization module | Represents an avatar image with metadata (file path, dimensions, format) |
| **Role.avatar** | New property | Role entity | Optional reference to avatar file or avatar metadata |
| **AvatarStorage** | New service | Infrastructure layer | Handles file I/O, validation, and cleanup operations |

### Related Existing Entities

| Concept | Relationship | Impact |
|---------|-------------|--------|
| Role | Parent entity | Add optional avatar property |
| Organization | Contains roles | May need avatar storage path configuration |
| IPC Handlers | Expose API | New channels for avatar upload/download |
| UI Components | Display avatars | Update team, task, conversation views |

## Business Rules

### Avatar Constraints

**BR-01: File Format**
- Allowed formats: JPEG (.jpg, .jpeg), PNG (.png), GIF (.gif), WebP (.webp)
- System rejects files with invalid format or missing file header
- System rejects animated GIFs (optional: support in future iteration)

**BR-02: File Size**
- Maximum file size: 5MB (configurable in app settings)
- System provides clear error message if file exceeds limit
- System compresses images exceeding recommended size threshold (2MB)

**BR-03: Image Dimensions**
- Minimum dimensions: 64x64 pixels
- Maximum dimensions: 1024x1024 pixels
- System auto-resizes images exceeding maximum to fit within bounds
- System maintains aspect ratio during resize

**BR-04: Storage**
- Avatars stored in designated directory within workspace path: `{workspace}/avatars/roles/`
- Filename format: `{roleId}-{hash}.{extension}` (hash prevents conflicts)
- System maintains avatar metadata in separate tracking structure (not SQLite blob)
- Maximum 10,000 avatars per organization (practical limit for filesystem)

**BR-05: Lifecycle**
- Avatar is created on first upload
- Avatar is replaced (old file deleted) on subsequent uploads
- Avatar is deleted (file removed) when user explicitly removes it
- Avatar is NOT automatically deleted when role is deleted (cleanup job handles this)

### Default Behavior

**BR-06: Default Avatar Generation**
- If no custom avatar: display initials-based avatar (first letter of each word in role name, max 2 letters)
- If role name is single word: display first two letters
- If role name is empty/missing: display generic person icon
- Default avatar uses color based on role name hash (consistent per role)

**BR-07: Avatar Access Control**
- All authenticated users can view role avatars
- Only role owner (or org admin) can upload/modify/delete avatar
- Avatar operations require same permissions as role update operations

### Validation Rules

**BR-08: Upload Validation**
- Validate file extension matches actual file content (magic bytes)
- Reject files with suspicious content (executables disguised as images)
- Log validation failures for security audit

**BR-09: Concurrent Upload**
- Use optimistic locking for avatar replacement operations
- Reject concurrent uploads to same role (one-at-a-time)
- Provide clear error message if conflict detected

## Ambiguities & Questions

### Critical Questions (Must Resolve Before Implementation)

| ID | Question | Impact | Options |
|----|----------|--------|---------|
| Q1 | **Should avatars be stored as files on local filesystem or as BLOBs in SQLite database?** | Architecture, storage, performance | A) Filesystem (recommended) - easier backup, smaller DB, more formats; B) SQLite BLOB - atomic with DB, simpler but bloats DB |
| Q2 | **Where should avatar files be stored?** | File organization, portability | A) Within workspace path (portable, backed up with workspace); B) System temp/config dir (separate from workspace); C) User-specified path |
| Q3 | **Should avatar be optional or required for all roles?** | UX, migration | A) Optional (recommended) - no breaking changes; B) Required - forces all roles to have avatars |
| Q4 | **Is there a need for avatar cropping/editing in the UI?** | UI complexity | A) No - upload as-is with auto-resize; B) Simple crop tool; C) Full editor |
| Q5 | **Should avatars be available to external AI agents via MCP tools?** | API surface | A) No - UI only; B) Yes - agents can query role avatars; C) Future consideration |

### Nice-to-Have Questions (Can Defer)

| ID | Question | Impact | Options |
|----|----------|--------|---------|
| Q6 | **Should the system support URL-based avatars (external URLs)?** | Complexity, security | A) No - upload only; B) Yes - allow URL input |
| Q7 | **Should avatar history be maintained (versioning)?** | Storage, complexity | A) No - overwrite only; B) Yes - keep previous versions |
| Q8 | **Should there be avatar size variations (thumbnail, medium, large)?** | Storage, UI complexity | A) Single size with client-side scaling; B) Multiple sizes generated server-side |

### Requirements Conflicts

None identified.

### Missing Information

| ID | Topic | Question | Resolution Path |
|----|-------|----------|-----------------|
| M1 | **Organization configuration** | Should avatar settings be configurable per-org or global? | Consult product owner or use global defaults |
| M2 | **Template handling** | Should org templates include default avatars for roles? | Check template structure; defer to future iteration |
| M3 | **Batch operations** | Should users be able to upload avatars for multiple roles at once? | Defer to future iteration |
| M4 | **Export/Import** | Should avatars be included when exporting/importing org structure? | Defer to future iteration |

## Resolved Decisions

All critical ambiguities have been resolved. The following decisions are final:

| ID | Decision | Rationale |
|----|----------|-----------|
| Q1 | **SQLite BLOB storage** | Avatar data will be stored as BLOBs directly in the database, not as filesystem files. This provides atomic operations with the database, simpler backup/restore, and avoids filesystem synchronization issues. |
| Q2 | **System directory** | Avatar storage location is the system/config directory (not workspace-specific). This keeps avatars consistent across workspace contexts and simplifies storage management. |
| Q3 | **Optional** | Avatar is optional for all roles. No breaking changes to existing data; roles continue to function normally without avatars. Default avatars will be generated dynamically when needed. |
| Q4 | **No cropping/editing** | Users upload images as-is. System will handle auto-resize and format normalization. This keeps UI complexity low and avoids needing image editing libraries. |
| Q5 | **No external API** | Avatars are UI-only and not exposed via MCP tools or external APIs. This limits API surface and keeps the feature focused on user experience. |

### Architecture Impact

Given these decisions, the implementation approach shifts:
- **Storage**: Use SQLite BLOB column in roles table (avoids filesystem management)
- **Data Model**: Add `avatar: Buffer | null` and `avatarMimeType: string | null` fields to Role entity
- **Service Layer**: Simple in-memory processing (resize, validate) before database write
- **No Infrastructure Changes**: No new file storage service needed - all handled by persistence layer
- **IPC API**: Simplified to single upload endpoint that accepts image buffer and stores in DB
- **Performance**: Consider caching strategies for BLOB retrieval in UI

## Change Tracking

**Analysis Date**: 2026-06-04

**Change ID**: `20260604-role-custom-avatar`

**Estimated Complexity**: High (touches 6-8 files across multiple layers)

**Files Impacted** (Preliminary):
1. `apps/electron/src/core/modules/organization/types/organization.types.ts` - Add avatar properties to Role, CreateRoleInput, UpdateRoleInput interfaces
2. `apps/electron/src/core/modules/organization/services/role.service.ts` - Add avatar CRUD operations
3. `apps/electron/src/core/modules/organization/persistence/sqlite-role.repository.ts` - Persist avatar metadata
4. `apps/electron/src/infrastructure/...` (new file) - AvatarStorage service for file handling
5. `apps/electron/src/ipc-handlers/...` - New IPC channels for avatar upload/download
6. `apps/electron/src/renderer/components/team/...` - UI components for avatar display/upload
7. Database migration script - Add avatar column to roles table
8. `apps/electron/src/preload/...` - Expose avatar API to renderer

**Dependencies**: None identified

**Suggested Next Steps**:
1. Resolve critical ambiguities (Q1-Q5) in design session
2. Proceed to `/mvt-design` for architecture blueprint
3. Then `/mvt-plan-dev` for implementation task breakdown
