import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { SupportedLocale, LocaleMessages } from '@shared/locale/types.js';
import { getMessages, DEFAULT_LOCALE, isSupportedLocale } from '@shared/locale/index.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = () => window.capibara as any;

interface LocaleContextValue {
  locale: SupportedLocale;
  messages: LocaleMessages;
  setLocale: (locale: SupportedLocale) => void;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: DEFAULT_LOCALE,
  messages: getMessages(DEFAULT_LOCALE),
  setLocale: () => {},
});

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<SupportedLocale>(DEFAULT_LOCALE);
  const [messages, setMessages] = useState<LocaleMessages>(getMessages(DEFAULT_LOCALE));

  useEffect(() => {
    api().getSetting?.('locale').then((result: { ok: boolean; data?: string | null }) => {
      if (result?.ok && result.data && isSupportedLocale(result.data)) {
        setLocaleState(result.data);
        setMessages(getMessages(result.data));
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (typeof api()?.subscribe !== 'function') return;
    const unsub = api().subscribe((event: { type: string; locale?: string }) => {
      if (event.type === 'settings:locale-changed' && event.locale && isSupportedLocale(event.locale)) {
        setLocaleState(event.locale);
        setMessages(getMessages(event.locale));
      }
    });
    return unsub;
  }, []);

  const setLocale = useCallback((newLocale: SupportedLocale) => {
    setLocaleState(newLocale);
    setMessages(getMessages(newLocale));
    api().setSetting?.('locale', newLocale);
  }, []);

  return (
    <LocaleContext.Provider value={{ locale, messages, setLocale }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale(): SupportedLocale {
  return useContext(LocaleContext).locale;
}

export function useT(): LocaleMessages {
  return useContext(LocaleContext).messages;
}

export function useLocaleContext(): LocaleContextValue {
  return useContext(LocaleContext);
}
