import { useEffect } from 'react';
import { SquaresFour, ListChecks, UsersThree, ChatCircleDots, CurrencyDollar, Sparkle, ArrowRight } from '@phosphor-icons/react';
import { useTaskStore } from '../../store/task.store';
import { useRunStore } from '../../store/run.store';
import { useConversationStore } from '../../store/conversation.store';
import { useOrganizationStore } from '../../store/organization.store';
import { useAppStore } from '../../store/app.store';
import { useT } from '../../hooks/use-locale';
import { buildNarrative, type NarrativeSection } from './narrative';

interface DashboardPageProps {
  orgId: string | null;
}

export function DashboardPage({ orgId }: DashboardPageProps) {
  const t = useT();
  const tasks = useTaskStore((s) => s.tasks);
  const loadTasks = useTaskStore((s) => s.loadTasks);
  const runs = useRunStore((s) => s.runs);
  const loadRuns = useRunStore((s) => s.loadRuns);
  const activeConversations = useConversationStore((s) => s.activeConversations);
  const loadActive = useConversationStore((s) => s.loadActiveConversations);
  const roles = useOrganizationStore((s) => s.roles);
  const loadRoles = useOrganizationStore((s) => s.loadRoles);
  const organizations = useAppStore((s) => s.organizations);
  const setActiveSection = useAppStore((s) => s.setActiveSection);

  const org = organizations.find((o) => o.id === orgId) ?? null;

  useEffect(() => {
    if (orgId) {
      void loadTasks(orgId);
      void loadRuns(orgId);
      void loadActive(orgId);
      void loadRoles(orgId);
    }
  }, [orgId, loadTasks, loadRuns, loadActive, loadRoles]);

  if (!orgId || !org) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
        <SquaresFour size={48} weight="duotone" />
        <p>{t.dashboard.noOrgSelected}</p>
      </div>
    );
  }

  const narrative = buildNarrative({
    t,
    orgName: org.name,
    tasks,
    runs,
    conversations: activeConversations,
    roles,
  });

  const activeTasks = tasks.filter((t) => !['done', 'cancelled'].includes(t.status));
  const activeRuns = runs.filter((r) => r.status === 'running');
  const aiRoles = roles.filter((r) => !r.isSystemRole);

  return (
    <div className="p-[var(--page-padding)] space-y-[var(--section-gap)]">
      <header>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <SquaresFour size={28} weight="duotone" />
          {t.dashboard.title}
        </h1>
      </header>

      <button
        onClick={() => setActiveSection('planning')}
        className="w-full text-left rounded-xl border border-border p-[var(--card-padding)] bg-gradient-to-br from-primary/5 via-background to-background hover:border-primary/30 hover:from-primary/10 transition-all group"
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
              <Sparkle size={20} weight="duotone" />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-sm">{t.dashboard.startPlanning.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t.dashboard.startPlanning.description}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 text-xs font-medium text-primary shrink-0 group-hover:gap-2 transition-all">
            {t.dashboard.startPlanning.cta}
            <ArrowRight size={14} />
          </div>
        </div>
      </button>

      <NarrativeCard headline={narrative.headline} sections={narrative.sections} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<ListChecks size={20} weight="duotone" />} label={t.dashboard.stats.activeTasks} value={activeTasks.length} color="text-blue-600" />
        <StatCard icon={<UsersThree size={20} weight="duotone" />} label={t.dashboard.stats.aiRoles} value={aiRoles.length} color="text-purple-600" />
        <StatCard icon={<ChatCircleDots size={20} weight="duotone" />} label={t.dashboard.stats.activeConversations} value={activeConversations.length} color="text-yellow-600" />
        <StatCard icon={<CurrencyDollar size={20} weight="duotone" />} label={t.dashboard.stats.activeRuns} value={activeRuns.length} color="text-green-600" />
      </div>
    </div>
  );
}

function NarrativeCard({ headline, sections }: { headline: string; sections: NarrativeSection[] }) {
  return (
    <section className="rounded-xl border border-border p-[var(--card-padding)] space-y-4 bg-gradient-to-br from-background to-muted/20">
      <div className="flex items-center gap-2">
        <Sparkle size={20} weight="duotone" className="text-primary" />
        <h2 className="text-lg font-semibold">{headline}</h2>
      </div>
      <div className="space-y-3">
        {sections.map((s, i) => (
          <NarrativeRow key={i} section={s} />
        ))}
      </div>
    </section>
  );
}

function NarrativeRow({ section }: { section: NarrativeSection }) {
  const toneBorder = {
    info: 'border-l-blue-500',
    positive: 'border-l-green-500',
    warning: 'border-l-amber-500',
    neutral: 'border-l-muted',
  }[section.tone];

  return (
    <div className={`border-l-2 pl-3 py-1 ${toneBorder}`}>
      <h3 className="text-sm font-medium text-foreground">{section.heading}</h3>
      <p className="text-sm text-muted-foreground mt-0.5">{section.body}</p>
    </div>
  );
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string | number; color: string }) {
  return (
    <div className="p-[var(--card-padding)] rounded-xl border border-border space-y-2">
      <div className={`flex items-center gap-2 ${color}`}>
        {icon}
        <span className="text-sm font-medium">{label}</span>
      </div>
      <p className="text-2xl font-semibold">{value}</p>
    </div>
  );
}
