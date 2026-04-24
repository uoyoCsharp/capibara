import { useEffect, useState } from 'react';
import { LocaleProvider, useT } from './hooks/use-locale';
import { useOnboardingGate } from './hooks/use-onboarding-gate';
import { useCrossCuttingToasts } from './hooks/use-cross-cutting-toasts';
import { useSectionShortcuts } from './hooks/use-section-shortcuts';
import { useAppStore } from './store/app.store';
import { useTaskStore } from './store/task.store';
import { useRunStore } from './store/run.store';
import { useConversationStore } from './store/conversation.store';
import { useOrganizationStore } from './store/organization.store';
import { usePlanningStore } from './store/planning.store';
import { Sidebar } from './components/layout/Sidebar';
import { SectionRouter } from './components/layout/SectionRouter';
import { OnboardingWizard } from './components/onboarding/OnboardingWizard';
import { ToastContainer } from './components/shared/ToastContainer';

export function App() {
  return (
    <LocaleProvider>
      <AppContent />
    </LocaleProvider>
  );
}

function AppContent() {
  const t = useT();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const activeSection = useAppStore((s) => s.activeSection);
  const setActiveSection = useAppStore((s) => s.setActiveSection);
  const currentOrgId = useAppStore((s) => s.currentOrgId);
  const isLoading = useAppStore((s) => s.isLoading);
  const loadOrganizations = useAppStore((s) => s.loadOrganizations);

  const { show: showOnboarding, isFirstTime, openForNewWorkspace, markComplete } = useOnboardingGate();

  // One-time store initialization — each store.init() is idempotent.
  useEffect(() => {
    useAppStore.getState().init();
    useTaskStore.getState().init();
    useRunStore.getState().init();
    useConversationStore.getState().init();
    useOrganizationStore.getState().init();
    usePlanningStore.getState().init();
  }, []);

  // Propagate current org to domain stores so their event filters work.
  useEffect(() => {
    useTaskStore.getState().setCurrentOrgId(currentOrgId);
    useRunStore.getState().setCurrentOrgId(currentOrgId);
    useConversationStore.getState().setCurrentOrgId(currentOrgId);
    useOrganizationStore.getState().setCurrentOrgId(currentOrgId);
  }, [currentOrgId]);

  useCrossCuttingToasts(activeSection, setActiveSection);
  useSectionShortcuts(setActiveSection);

  if (isLoading || showOnboarding === null) {
    return <LoadingScreen label={t.common?.loading ?? 'Loading...'} />;
  }

  if (showOnboarding) {
    return (
      <OnboardingWizard
        onComplete={markComplete}
        skipHealthCheck={!isFirstTime}
        isFirstTime={isFirstTime}
      />
    );
  }

  const handleWorkspaceDeleted = () => {
    setActiveSection('dashboard');
    void loadOrganizations();
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      <Sidebar
        activeSection={activeSection}
        onNavigate={setActiveSection}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
        onCreateWorkspace={openForNewWorkspace}
      />
      <main className="flex-1 overflow-auto">
        <SectionRouter
          activeSection={activeSection}
          orgId={currentOrgId}
          onWorkspaceDeleted={handleWorkspaceDeleted}
        />
      </main>
      <ToastContainer />
    </div>
  );
}

function LoadingScreen({ label }: { label: string }) {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background">
      <div className="text-center">
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
        <p className="text-sm text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}
