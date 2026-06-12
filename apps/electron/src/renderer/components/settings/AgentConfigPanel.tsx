import { useState, useEffect } from 'react';
import { Robot, GitBranch, ShieldCheck } from '@phosphor-icons/react';
import type { AgentConfigSummary } from '@core/shared/types';
import { Badge } from '../ui/badge';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../ui/select';
import { useT } from '../../hooks/use-locale';
import { toast } from '../../store/toast.store';
import { ModelSelector } from './ModelSelector';

const api = () => window.capibara;

export function AgentConfigPanel() {
  const t = useT();
  const ac = t.settings.agentConfig;
  const [config, setConfig] = useState<AgentConfigSummary | null>(null);
  const [changing, setChanging] = useState(false);

  useEffect(() => {
    void api().getAgentConfig().then((result) => {
      if (result.ok) setConfig(result.data);
    });
  }, []);

  const handleAgentChange = async (agentId: string) => {
    setChanging(true);
    try {
      const result = await api().setDefaultAgent(agentId);
      if (result.ok) {
        setConfig((prev) => prev ? { ...prev, defaultAgent: result.data.defaultAgent } : prev);
        toast.success(ac.defaultAgentSet);
      } else {
        toast.error(ac.defaultAgentSetFailed);
      }
    } finally {
      setChanging(false);
    }
  };

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
          <label className="text-xs text-muted-foreground">{ac.defaultAgentLabel}</label>
          <Select value={config.defaultAgent} onValueChange={handleAgentChange} disabled={changing}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {config.registry.map((agent) => (
                <SelectItem key={agent.id} value={agent.id}>
                  <span className="flex items-center justify-between w-full gap-2">
                    <span>{agent.name}</span>
                    <code className="text-xs text-muted-foreground">{agent.command}</code>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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

      {/* Model Selection */}
      <section className="rounded-xl border border-border p-[var(--card-padding)] space-y-4">
        <ModelSelector />
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
