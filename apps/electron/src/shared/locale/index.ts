import type { SupportedLocale, LocaleMessages } from './types.js';
import { enUS } from './en-US.js';
import { zhCN } from './zh-CN.js';

export type { SupportedLocale, LocaleMessages } from './types.js';

const localeMap: Record<SupportedLocale, LocaleMessages> = {
  'en-US': enUS,
  'zh-CN': zhCN,
};

export const SUPPORTED_LOCALES: SupportedLocale[] = ['en-US', 'zh-CN'];

export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  'en-US': 'EN',
  'zh-CN': '中文',
};

export const DEFAULT_LOCALE: SupportedLocale = 'en-US';

export function getMessages(locale: SupportedLocale): LocaleMessages {
  return localeMap[locale] ?? localeMap[DEFAULT_LOCALE];
}

export function isSupportedLocale(value: string): value is SupportedLocale {
  return SUPPORTED_LOCALES.includes(value as SupportedLocale);
}

export function detectLocaleFromOS(osLocale: string): SupportedLocale {
  if (osLocale.startsWith('zh')) return 'zh-CN';
  return 'en-US';
}
