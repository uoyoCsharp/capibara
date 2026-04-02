import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { SupportedLocale, LocaleMessages } from '@shared/locale/types.js';
import type { DesktopEvent } from '@shared/contracts';
import { getMessages, DEFAULT_LOCALE, isSupportedLocale } from '@shared/locale/index.js';

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

  // Load initial locale from Main process
  useEffect(() => {
    if (typeof window.capibara?.getLocale !== 'function') return;

    window.capibara.getLocale().then((result) => {
      if (result.ok && isSupportedLocale(result.data)) {
        setLocaleState(result.data);
        setMessages(getMessages(result.data));
      }
    });
  }, []);

  // Listen for locale changes from Main process
  useEffect(() => {
    if (typeof window.capibara?.subscribe !== 'function') return;

    const unsub = window.capibara.subscribe((event: DesktopEvent) => {
      if (event.type === 'settings:locale-changed' && isSupportedLocale(event.locale)) {
        setLocaleState(event.locale);
        setMessages(getMessages(event.locale));
      }
    });

    return unsub;
  }, []);

  const setLocale = useCallback((newLocale: SupportedLocale) => {
    setLocaleState(newLocale);
    setMessages(getMessages(newLocale));

    if (typeof window.capibara?.updateSetting === 'function') {
      window.capibara.updateSetting({ key: 'locale', value: newLocale });
    }
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
