import { useState } from 'react';
import { HealthCheckStep } from './HealthCheckStep';
import { NamingTemplateStep } from './NamingTemplateStep';

interface OnboardingWizardProps {
  onComplete: () => void;
  /** Skip health check step (for existing users creating additional workspaces) */
  skipHealthCheck?: boolean;
  /** Whether this is a first-time onboarding (controls onboardingCompleted setting) */
  isFirstTime?: boolean;
}

export function OnboardingWizard({ onComplete, skipHealthCheck = false, isFirstTime = true }: OnboardingWizardProps) {
  const [step, setStep] = useState<'health' | 'naming'>(skipHealthCheck ? 'naming' : 'health');

  if (step === 'health') {
    return <HealthCheckStep onContinue={() => setStep('naming')} />;
  }

  return <NamingTemplateStep onComplete={onComplete} isFirstTime={isFirstTime} />;
}
