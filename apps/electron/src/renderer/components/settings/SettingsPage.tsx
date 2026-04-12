import { Gear } from '@phosphor-icons/react';
import { useT } from '../../hooks/useLocale';
import { LanguageSelector } from '../layout/LanguageSelector';

export function SettingsPage() {
  const t = useT();
  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">{t.sections.settings}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Application preferences and configuration
        </p>
      </div>

      <div className="max-w-xl space-y-6">
        {/* Language */}
        <div className="rounded-lg border p-4">
          <h2 className="mb-3 text-sm font-medium text-foreground">{t.i18n.language}</h2>
          <LanguageSelector collapsed={false} />
        </div>
      </div>
    </div>
  );
}
