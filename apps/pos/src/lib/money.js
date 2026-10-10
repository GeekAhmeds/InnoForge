// Amounts travel as integer minor units; the UI shows and accepts major units.
export function toMinor(value, decimals = 2) {
  const n = Number(String(value ?? '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 10 ** decimals) : 0;
}

export function fromMinor(minor, decimals = 2) {
  return (Number(minor || 0) / 10 ** decimals).toFixed(decimals);
}

export function formatMoney(minor, settings) {
  const d = settings?.decimals ?? 2;
  const n = (Number(minor || 0) / 10 ** d).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  return settings?.currency_symbol ? `${n} ${settings.currency_symbol}` : n;
}

export function formatQty(q) {
  return Number.isInteger(Number(q)) ? String(q) : Number(q).toFixed(3).replace(/0+$/, '');
}
