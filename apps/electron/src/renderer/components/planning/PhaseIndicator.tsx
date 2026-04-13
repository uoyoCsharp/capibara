import { Check } from '@phosphor-icons/react';
import { cn } from '../../lib/utils';
import { useT } from '../../hooks/useLocale';

export type PlanningPhase = 'diverge' | 'focus' | 'structure';

const PHASES: PlanningPhase[] = ['diverge', 'focus', 'structure'];

interface PhaseIndicatorProps {
  currentPhase: PlanningPhase;
}

export function PhaseIndicator({ currentPhase }: PhaseIndicatorProps) {
  const t = useT();
  const currentIdx = PHASES.indexOf(currentPhase);

  const labels: Record<PlanningPhase, string> = {
    diverge: t.planning.phaseDiverge,
    focus: t.planning.phaseFocus,
    structure: t.planning.phaseStructure,
  };

  return (
    <div className="flex items-center gap-2">
      {PHASES.map((phase, idx) => {
        const isCompleted = idx < currentIdx;
        const isActive = idx === currentIdx;

        return (
          <div key={phase} className="flex items-center gap-2">
            {idx > 0 && (
              <div
                className={cn(
                  'h-px w-8',
                  isCompleted || isActive ? 'bg-primary' : 'bg-border',
                )}
              />
            )}
            <div className="flex items-center gap-1.5">
              <div
                className={cn(
                  'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold transition-colors',
                  isCompleted && 'bg-primary text-primary-foreground',
                  isActive && 'bg-primary text-primary-foreground ring-2 ring-primary/30',
                  !isCompleted && !isActive && 'bg-muted text-muted-foreground',
                )}
              >
                {isCompleted ? <Check size={12} weight="bold" /> : idx + 1}
              </div>
              <span
                className={cn(
                  'text-xs font-medium',
                  isActive ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {labels[phase]}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
