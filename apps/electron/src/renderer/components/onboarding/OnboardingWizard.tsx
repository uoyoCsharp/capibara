import { useState } from 'react';
import { HealthCheckStep } from './HealthCheckStep';
import { NamingTemplateStep } from './NamingTemplateStep';

interface OnboardingWizardProps {
  onComplete: () => void;
}

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState<'health' | 'naming'>('health');

  if (step === 'health') {
    return <HealthCheckStep onContinue={() => setStep('naming')} />;
  }

  return <NamingTemplateStep onComplete={onComplete} />;
}
