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
      return dict[key] || en[key] ? t(key) + (err.code === 'OUT_OF_STOCK' && err.message ? `: ${err.message}` : '') : err?.message || String(err);
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
