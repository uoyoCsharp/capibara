import { useState, useEffect } from 'react';
import type { SectionId, DesktopEvent } from '@shared/contracts';
import { useCapibaraSnapshot } from './hooks/useCapibaraSnapshot';
import { LocaleProvider, useT } from './hooks/useLocale';
import { Sidebar } from './components/layout/Sidebar';
import { DashboardPage } from './components/dashboard/DashboardPage';
import { OrganizationPage } from './components/organization/OrganizationPage';
import { SkillsPage } from './components/skills/SkillsPage';
import { ExecutionPage } from './components/execution/ExecutionPage';
import { DiscussionPage } from './components/discussion/DiscussionPage';
import { ConversationPage } from './components/conversations/ConversationPage';
import { ToastContainer } from './components/shared/ToastContainer';
import { toast } from './store/toast.store';

export function App() {
  return (
    <LocaleProvider>
      <AppContent />
    </LocaleProvider>
  );
}

function AppContent() {
  const [activeSection, setActiveSection] = useState<SectionId>('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const { currentOrgId, isLoading } = useCapibaraSnapshot();
  const t = useT();

  // Run completion toast notifications
  useEffect(() => {
    if (typeof window.capibara?.subscribe !== 'function') return;

    const unsub = window.capibara.subscribe((event: DesktopEvent) => {
      if (event.type === 'run:completed') {
        switch (event.status) {
          case 'succeeded':
            toast.success(`${t.runs.completed} — ${(event.tokenCount / 1_000_000).toFixed(4)}M tokens`);
            break;
          case 'failed':
            toast.error(t.runs.failed);
            break;
          case 'cancelled':
            toast.info(t.runs.cancelled);
            break;
        }
      }
      if (event.type === 'conversation:question-posted' && event.respondentType === 'human') {
        toast.info(
          `${t.conversations.humanReplyNotification}: ${event.askingRoleName || 'AI'} ${t.conversations.humanReplyNotificationBody}`,
          {
            duration: 10000,
            action: { label: t.conversations.goToConversations, onClick: () => setActiveSection('conversations') },
          },
        );
      }
    });

    return unsub;
  }, [t, setActiveSection]);

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
          <p className="text-sm text-muted-foreground">{t.common.loading}</p>
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
      case 'conversations':
        return <ConversationPage />;
      default:
        return <DashboardPage orgId={currentOrgId} />;
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
