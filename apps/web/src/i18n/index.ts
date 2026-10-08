import ar from './ar.json';
import en from './en.json';

/**
 * All screen text lives in these files, never in components.
 * ar.json is a partial first draft to prove right-to-left layout. It must be completed and reviewed
 * by a native speaker who knows site terminology before Arabic ships (Phase 2). Missing keys fall back to English.
 */
export type Locale = 'en' | 'ar';
export type Key = keyof typeof en;
const tables: Record<Locale, Partial<Record<Key, string>>> = { en, ar };

export function translate(locale: Locale, key: Key, vars: Record<string, string | number> = {}): string {
  const text = tables[locale][key] ?? en[key];
  return text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}

export function applyLocale(locale: Locale) {
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
}
