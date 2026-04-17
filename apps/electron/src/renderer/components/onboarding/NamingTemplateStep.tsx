import { useState, useEffect, useCallback, type ChangeEvent } from 'react';
import {
  ArrowRight,
  Star,
  FolderOpen,
  UsersThree,
  CircleNotch,
} from '@phosphor-icons/react';
import { useT } from '../../hooks-v2/use-locale';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = () => window.capibara as any;
type TemplateRecord = { id: string; name: string; description: string; rootRoles: Array<{ children: TemplateRecord['rootRoles'] }> };
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { cn } from '../../lib/utils';
import logoImg from '../../assets/logo.png';

interface NamingTemplateStepProps {
  onComplete: () => void;
  /** Whether this is a first-time onboarding (controls onboardingCompleted setting) */
  isFirstTime?: boolean;
}

function countAgents(template: TemplateRecord): number {
  let count = 0;
  const walk = (roles: TemplateRecord['rootRoles']) => {
    for (const r of roles) { count++; walk(r.children); }
  };
  walk(template.rootRoles);
  return count;
}

export function NamingTemplateStep({ onComplete, isFirstTime = true }: NamingTemplateStepProps) {
  const t = useT();
  const [name, setName] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [templates, setTemplates] = useState<TemplateRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api().getTemplates().then((res: { ok: boolean; data?: TemplateRecord[] }) => {
      if (res.ok && res.data) {
        setTemplates(res.data);
        if (res.data.length > 0) setSelectedId(res.data[0].id);
      }
    });
  }, []);

  const handleBrowse = useCallback(async () => {
    const res = await api().selectFolder();
    if (res.ok && res.data) setWorkspace(res.data);
  }, []);

  const canSubmit = name.trim().length > 0 && selectedId !== null && workspace.length > 0 && !creating;

  const handleSubmit = async () => {
    if (!canSubmit || !selectedId) return;
    setCreating(true);
    try {
      const res = await api().loadTemplate(selectedId, name.trim(), workspace);
      if (res.ok) {
        if (isFirstTime) {
          // Mark onboarding complete only on first-time setup
          await api().setSetting('onboardingCompleted', 'true');
        }
        // Switch to the newly created org
        if (res.data?.id) {
          await api().setSetting('currentOrgId', res.data.id);
        }
        onComplete();
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6">
      <div className="w-full max-w-2xl space-y-8">
        {/* Header */}
        <div className="text-center space-y-3">
          <img src={logoImg} alt="Capibara" className="mx-auto h-16 w-16 rounded-2xl" />
          <h1 className="text-2xl font-bold text-foreground">{t.onboarding.namingTitle}</h1>
          <p className="text-sm text-muted-foreground">{t.onboarding.namingSubtitle}</p>
        </div>

        {/* Space Name */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">{t.onboarding.spaceName}</label>
          <Input
            value={name}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
            placeholder={t.onboarding.spaceNamePlaceholder}
            className="h-12 text-lg"
            autoFocus
          />
        </div>

        {/* Workspace Folder */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">{t.createOrg.workspaceLabel}</label>
          <div className="flex gap-2">
            <Input
              value={workspace}
              readOnly
              placeholder={t.createOrg.workspacePlaceholder}
              className="flex-1"
            />
            <Button variant="outline" onClick={handleBrowse}>
              <FolderOpen size={16} className="mr-1.5" />
              {t.common.browse}
            </Button>
          </div>
        </div>

        {/* Template Selection */}
        <div className="space-y-3">
          <label className="text-sm font-medium text-foreground">{t.onboarding.chooseTemplate}</label>
          <div className="grid gap-3 sm:grid-cols-2">
            {templates.map((tpl, idx) => {
              const agentCount = countAgents(tpl);
              const isSelected = selectedId === tpl.id;
              return (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => setSelectedId(tpl.id)}
                  className={cn(
                    'relative rounded-lg border p-4 text-left transition-all',
                    isSelected
                      ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                      : 'border-border hover:border-muted-foreground/30 hover:bg-muted/30',
                  )}
                >
                  {idx === 0 && (
                    <span className="absolute -top-2 right-3 inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
                      <Star size={10} weight="fill" />
                      {t.onboarding.recommended}
                    </span>
                  )}
                  <h3 className="text-sm font-semibold text-foreground">{tpl.name}</h3>
                  <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{tpl.description}</p>
                  <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <UsersThree size={12} /> {agentCount} {t.onboarding.agents}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Submit */}
        <div className="flex justify-end">
          <Button onClick={handleSubmit} disabled={!canSubmit} size="lg">
            {creating ? (
              <>
                <CircleNotch size={16} className="mr-1.5 animate-spin" />
                {t.onboarding.creating}
              </>
            ) : (
              <>
                {t.onboarding.letsGo}
                <ArrowRight size={16} className="ml-1.5" />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
