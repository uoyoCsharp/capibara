import { useState } from 'react';
import type { SectionId } from '@shared/contracts';
import { useCapibaraSnapshot } from './hooks/useCapibaraSnapshot';
import { Sidebar } from './components/layout/Sidebar';
import { DashboardPage } from './components/dashboard/DashboardPage';
import { OrganizationPage } from './components/organization/OrganizationPage';
import { SkillsPage } from './components/skills/SkillsPage';
import { ExecutionPage } from './components/execution/ExecutionPage';
import { DiscussionPage } from './components/discussion/DiscussionPage';

export function App() {
  const [activeSection, setActiveSection] = useState<SectionId>('dashboard');
  const { organizations, currentOrgId, isLoading } = useCapibaraSnapshot();

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#fafafa]">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-indigo-600" />
          <p className="text-sm text-gray-400">Loading Capibara...</p>
        </div>
      </div>
    );
  }

  const renderPage = () => {
    switch (activeSection) {
      case 'dashboard':
        return <DashboardPage orgId={currentOrgId} />;
      case 'organization':
        return <OrganizationPage />;
      case 'skills':
        return <SkillsPage />;
      case 'execution':
        return <ExecutionPage />;
      case 'discussion':
        return <DiscussionPage />;
      default:
        return <DashboardPage orgId={currentOrgId} />;
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#fafafa]">
      <Sidebar activeSection={activeSection} onNavigate={setActiveSection} />
      <main className="flex-1 overflow-auto">
        {renderPage()}
      </main>
    </div>
  );
}
