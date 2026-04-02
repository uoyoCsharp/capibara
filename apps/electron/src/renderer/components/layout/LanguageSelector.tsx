import { Globe } from '@phosphor-icons/react';
import { LOCALE_LABELS } from '@shared/locale/index.js';
import { useLocaleContext } from '../../hooks/useLocale';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';

interface LanguageSelectorProps {
  collapsed: boolean;
}

export function LanguageSelector({ collapsed }: LanguageSelectorProps) {
  const { locale, setLocale } = useLocaleContext();

  const toggle = () => {
    setLocale(locale === 'en-US' ? 'zh-CN' : 'en-US');
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={toggle}
      title={collapsed ? LOCALE_LABELS[locale] : undefined}
      className={cn(
        'w-full text-xs text-muted-foreground',
        collapsed ? 'justify-center px-0' : 'justify-start gap-2',
      )}
    >
      <Globe size={16} className="shrink-0" />
      {!collapsed && LOCALE_LABELS[locale]}
    </Button>
  );
}
