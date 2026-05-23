import { useState, useEffect } from 'react';
import { Robot, GitBranch, ShieldCheck } from '@phosphor-icons/react';
import type { AgentConfigSummary } from '@core/shared/types';
import { Badge } from '../ui/badge';
import { useT } from '../../hooks/use-locale';

const api = () => window.capibara;

export function AgentConfigPanel() {
  const t = useT();
  const ac = t.settings.agentConfig;
  const [config, setConfig] = useState<AgentConfigSummary | null>(null);

  useEffect(() => {
    void api().getAgentConfig().then((result) => {
      if (result.ok) setConfig(result.data);
    });
  }, []);

  if (!config) return null;

  return (
    <>
      {/* Agent Registry */}
      <section className="rounded-xl border border-border p-[var(--card-padding)] space-y-4">
        <h2 className="font-semibold flex items-center gap-2">
          <Robot size={18} weight="duotone" />
          {ac.title}
        </h2>
        <p className="text-sm text-muted-foreground">{ac.description}</p>

        <div className="space-y-2">
          {config.registry.map((agent) => (
            <div
              key={agent.id}
              className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{agent.name}</span>
                {agent.id === config.defaultAgent && (
                  <Badge variant="secondary" className="text-xs">{ac.defaultAgent}</Badge>
                )}
              </div>
              <code className="text-xs text-muted-foreground">{agent.command}</code>
            </div>
          ))}
        </div>

        {/* Global deny patterns */}
        <div>
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1">
            <ShieldCheck size={14} />
            {ac.denyPatterns}
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {config.globalFilePolicy.denyPatterns.map((p) => (
              <Badge key={p} variant="outline" className="font-mono text-xs">{p}</Badge>
            ))}
          </div>
        </div>
      </section>

      {/* Collaboration Config */}
      <section className="rounded-xl border border-border p-[var(--card-padding)] space-y-4">
        <h2 className="font-semibold flex items-center gap-2">
          <GitBranch size={18} weight="duotone" />
          {ac.collaborationTitle}
        </h2>
        <p className="text-sm text-muted-foreground">{ac.collaborationDescription}</p>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <ConfigTile label={ac.maxChainDepth} value={config.collaboration.maxChainDepth} />
          <ConfigTile label={ac.maxBroadcastTargets} value={config.collaboration.maxBroadcastTargets} />
          <ConfigTile label={ac.maxResumeCount} value={config.collaboration.maxResumeCount} />
          <ConfigTile label={ac.inquiryTimeoutMs} value={config.collaboration.inquiryTimeoutMs} />
        </div>
      </section>
    </>
  );
}

function ConfigTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-mono font-medium">{value.toLocaleString()}</p>
    </div>
  );
}
