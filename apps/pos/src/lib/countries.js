// Countries the app is sold in: currency, VAT rate and e-invoice system (from editions.json,
// the same file the license and the main process use).
import data from '../../electron/editions.json';

export const COUNTRIES = data.countries;
export const COUNTRY_FLAGS = { EG: '🇪🇬', SA: '🇸🇦', AE: '🇦🇪' };
export const countryName = (code, lang) => COUNTRIES[code]?.[lang === 'en' ? 'en' : 'ar'] || code;

/** Settings that follow from picking a country (the user can still change them). */
export function countryPreset(code) {
  const c = COUNTRIES[code];
  return c ? { country: code, currency: c.currency, currency_symbol: c.symbol, tax_rate: c.tax_rate, prices_include_tax: true } : {};
}

/** Which e-invoice system runs here: 'eta' | 'zatca' | 'uae_einvoice'. */
export const einvoiceOf = (settings) => COUNTRIES[settings?.country || 'EG']?.einvoice;
