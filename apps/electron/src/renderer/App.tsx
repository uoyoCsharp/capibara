import { useState, useEffect } from 'react';
import type { SectionId, DesktopEvent } from '@core/shared/types';
import { useAppSnapshot } from './hooks-v2/use-app-snapshot';
import { Sidebar } from './components-v2/layout/Sidebar';
import { DashboardPage } from './components-v2/dashboard/DashboardPage';
import { TasksPage } from './components-v2/tasks/TasksPage';
import { InboxPage } from './components-v2/inbox/InboxPage';
import { TeamPage } from './components-v2/team/TeamPage';
import { SettingsPage } from './components-v2/settings/SettingsPage';
import { OrgSettingsPage } from './components-v2/organization/OrgSettingsPage';
import { PlanningPage } from './components-v2/planning/PlanningPage';
import { ToastContainer } from './components/shared/ToastContainer';
import { toast } from './store/toast.store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = () => window.capibara as any;

export function App() {
  const [activeSection, setActiveSection] = useState<SectionId>('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const { organizations, currentOrgId, isLoading, refresh } = useAppSnapshot();

  useEffect(() => {
    if (typeof api()?.subscribe !== 'function') return;
    const unsub = api().subscribe((event: DesktopEvent) => {
      if (event.type === 'run:completed') {
        if (event.status === 'succeeded') toast.success(`Run completed — ${event.tokenCount} tokens`);
        else if (event.status === 'failed') toast.error('Run failed');
        else if (event.status === 'cancelled') toast.info('Run cancelled');
      }
      if (event.type === 'conversation:response-needed') {
        toast.info('Conversation needs response', {
          duration: 5000,
          action: { label: 'View', onClick: () => setActiveSection('inbox') },
        });
      }
    });
    return unsub;
  }, []);

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    );
  }

  const renderPage = () => {
    switch (activeSection) {
      case 'dashboard': return <DashboardPage orgId={currentOrgId} />;
      case 'tasks': return <TasksPage orgId={currentOrgId} />;
      case 'inbox': return <InboxPage orgId={currentOrgId} />;
      case 'team': return <TeamPage orgId={currentOrgId} />;
      case 'settings': return <SettingsPage />;
      case 'planning': return <PlanningPage orgId={currentOrgId} />;
      case 'workspace': return <OrgSettingsPage orgId={currentOrgId} onDeleted={() => { setActiveSection('dashboard'); refresh(); }} />;
      default: return <DashboardPage orgId={currentOrgId} />;
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      <Sidebar
        activeSection={activeSection}
        onNavigate={setActiveSection}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
      />
      <main className="flex-1 overflow-auto">
        {renderPage()}
      </main>
      <ToastContainer />
    </div>
  );
}
