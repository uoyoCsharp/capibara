import type { SectionId } from '@core/shared/types';
import { DashboardPage } from '../dashboard/DashboardPage';
import { TasksPage } from '../tasks/TasksPage';
import { InboxPage } from '../inbox/InboxPage';
import { TeamPage } from '../team/TeamPage';
import { SettingsPage } from '../settings/SettingsPage';
import { OrgSettingsPage } from '../organization/OrgSettingsPage';

interface SectionRouterProps {
  activeSection: SectionId;
  orgId: string | null;
  onWorkspaceDeleted: () => void;
}

/**
 * Thin mapping from SectionId to page component. Kept separate from App.tsx
 * so the shell stays a true shell. Adding a new section = one new case here.
 */
export function SectionRouter({ activeSection, orgId, onWorkspaceDeleted }: SectionRouterProps) {
  switch (activeSection) {
    case 'dashboard':
      return <DashboardPage orgId={orgId} />;
    case 'tasks':
      return <TasksPage orgId={orgId} />;
    case 'inbox':
      return <InboxPage orgId={orgId} />;
    case 'team':
      return <TeamPage orgId={orgId} />;
    case 'settings':
      return <SettingsPage />;
    case 'workspace':
      return <OrgSettingsPage orgId={orgId} onDeleted={onWorkspaceDeleted} />;
    default:
      return <DashboardPage orgId={orgId} />;
  }
}
