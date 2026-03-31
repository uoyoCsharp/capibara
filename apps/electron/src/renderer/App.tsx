import { useState } from 'react';
import type { SectionId } from '@shared/contracts';
import { Sidebar } from './components/layout/Sidebar';
import { DashboardPage } from './components/dashboard/DashboardPage';
import { OrganizationPage } from './components/organization/OrganizationPage';
import { SkillsPage } from './components/skills/SkillsPage';
import { ExecutionPage } from './components/execution/ExecutionPage';
import { DiscussionPage } from './components/discussion/DiscussionPage';

export function App() {
  const [activeSection, setActiveSection] = useState<SectionId>('dashboard');

  const renderPage = () => {
    switch (activeSection) {
      case 'dashboard':
        return <DashboardPage />;
      case 'organization':
        return <OrganizationPage />;
      case 'skills':
        return <SkillsPage />;
      case 'execution':
        return <ExecutionPage />;
      case 'discussion':
        return <DiscussionPage />;
      default:
        return <DashboardPage />;
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
