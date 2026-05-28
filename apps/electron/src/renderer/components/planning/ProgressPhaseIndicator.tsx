import { useState } from 'react';
import { Sparkle, CaretDown, CaretRight } from '@phosphor-icons/react';
import type { ToolCallEvent } from '../../hooks/use-tool-calls';
import { ToolCallList } from './ToolCallList';
import { MarkdownContent } from '../ui/markdown-content';
import { useT } from '../../hooks/use-locale';
import type { LocaleMessages } from '@shared/locale/types';

function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

interface ProgressPhaseIndicatorProps {
  toolCalls: ToolCallEvent[];
  streamingText: string;
  elapsedSeconds: number;
  fadingOut?: boolean;
}

export function ProgressPhaseIndicator({
  toolCalls,
  streamingText,
  elapsedSeconds,
  fadingOut = false,
}: ProgressPhaseIndicatorProps) {
  const t = useT();
  const [collapsed, setCollapsed] = useState(false);
  const hasToolCalls = toolCalls.length > 0;
  const hasContent = hasToolCalls || !!streamingText;

  return (
    <div
      className={`flex justify-start ${fadingOut ? 'planning-fade-out' : ''}`}
      aria-live="polite"
    >
      <div className="max-w-[80%] w-full bg-accent/60 border border-dashed border-border rounded-lg px-3 py-2">
        {/* Header */}
        <div className="flex items-center gap-1.5 mb-1">
          <Sparkle size={14} weight="duotone" className="text-primary animate-pulse shrink-0" />
          <span className="text-xs font-medium opacity-70">{t.planningChat.aiBusyLabel}</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {elapsedSeconds > 0
              ? interpolate(t.planningChat.thinkingWithTime, { seconds: elapsedSeconds })
              : t.planningChat.thinking}
          </span>
          {hasContent && (
            <button
              onClick={() => setCollapsed(c => !c)}
              className="ml-auto p-0.5 text-muted-foreground hover:text-foreground transition-colors"
              aria-label={collapsed ? t.common.expand : t.common.collapse}
            >
              {collapsed ? <CaretRight size={12} /> : <CaretDown size={12} />}
            </button>
          )}
        </div>

        {/* Collapsible content */}
        {!collapsed && (
          <div className="space-y-2">
            {hasToolCalls && <ToolCallList toolCalls={toolCalls} />}

            {streamingText && (
              <div className="opacity-40 text-sm">
                <MarkdownContent content={streamingText} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
