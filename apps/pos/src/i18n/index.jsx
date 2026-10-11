import React, { createContext, useContext, useEffect, useMemo } from 'react';
import ar from './ar.js';
import en from './en.js';

const DICTS = { ar, en };
const I18nContext = createContext(null);

export function I18nProvider({ lang = 'ar', children }) {
  const value = useMemo(() => {
    const dict = DICTS[lang] || ar;
    const t = (key, vars) => {
      let s = dict[key] ?? en[key] ?? key;
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
      return s;
    };
    // Error codes from the main process map to "err.<CODE>" keys.
    const tErr = (err) => {
      const key = `err.${err?.code}`;
      if (!(dict[key] || en[key])) return err?.message || String(err);
      // "{0}" in a message is filled with the detail the main process sent (e.g. the product name).
      const detail = err.message && err.message !== err.code ? err.message : '';
      const text = t(key);
      if (text.includes('{0}')) return text.replace('{0}', detail);
      return text + (err.code === 'OUT_OF_STOCK' && detail ? `: ${detail}` : '');
    };
    return { lang, dir: lang === 'ar' ? 'rtl' : 'ltr', t, tErr };
  }, [lang]);

  useEffect(() => {
    document.documentElement.lang = value.lang;
    document.documentElement.dir = value.dir;
  }, [value]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);
