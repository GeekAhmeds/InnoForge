// Saudi e-invoice (ZATCA / FATOORA) QR: TLV fields → Base64. Phase 1 (generation) needs
// tags 1–5; phase 2 adds the invoice hash, signature and keys (built in electron/zatca.cjs,
// stored on the order as zatca_qr).

/** Tag-length-value bytes for the given values (strings or byte arrays), Base64-encoded. */
export function zatcaTlv(values) {
  const out = [];
  values.forEach((v, i) => {
    const bytes = typeof v === 'string' ? Array.from(new TextEncoder().encode(v)) : Array.from(v);
    if (bytes.length > 255) throw new Error(`ZATCA QR field ${i + 1} is too long`);
    out.push(i + 1, bytes.length, ...bytes);
  });
  let bin = '';
  for (const b of out) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Decodes a ZATCA QR (for tests and the status screen): { 1: 'seller', 2: 'vat', … }. */
export function zatcaTlvDecode(b64) {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const out = {};
  for (let i = 0; i < bytes.length;) {
    const tag = bytes[i]; const len = bytes[i + 1];
    const val = bytes.slice(i + 2, i + 2 + len);
    out[tag] = tag <= 5 ? new TextDecoder().decode(val) : val;
    i += 2 + len;
  }
  return out;
}

/** 'YYYY-MM-DD HH:MM:SS' (how orders store their time) → 'YYYY-MM-DDTHH:MM:SS'. */
export const zatcaTime = (s) => String(s || '').trim().replace(' ', 'T').slice(0, 19);

/** Amount in minor units → '1150.00'. */
export const zatcaAmount = (minor, decimals = 2) => (Number(minor || 0) / 10 ** decimals).toFixed(2);

/** Phase-1 QR text for an order (seller name, VAT number, time, total with VAT, VAT). */
export function zatcaQrForOrder(order, settings) {
  if (order.zatca_qr) return order.zatca_qr; // signed (phase 2)
  if (settings.country !== 'SA' || !settings.tax_number) return '';
  const d = Number(settings.decimals ?? 2);
  return zatcaTlv([
    String(settings.business_name || ''), String(settings.tax_number), zatcaTime(order.completed_at || order.created_at),
    zatcaAmount(order.total, d), zatcaAmount(order.tax, d),
  ]);
}
