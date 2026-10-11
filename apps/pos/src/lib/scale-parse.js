// Parses what a retail scale sends over its serial cable. Scales differ, but most send
// lines like "ST,GS,+  1.250kg", "   1.250 kg", "W+001250g" or "001250" (grams).
// Returns { weight (kg), stable } for the last complete reading, or null.
export function parseScaleLine(line) {
  const text = String(line || '').replace(/[\x00-\x1f]/g, ' ').trim();
  const m = text.match(/([-+]?)\s*(\d+(?:[.,]\d+)?)\s*(kg|g|lb)?/i);
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  const num = Number(m[2].replace(',', '.'));
  const unit = (m[3] || '').toLowerCase();
  let kg;
  if (unit === 'kg') kg = num;
  else if (unit === 'g') kg = num / 1000;
  else if (unit === 'lb') kg = num * 0.45359237;
  // No unit: a decimal number is kilograms, a whole number is grams.
  else kg = m[2].match(/[.,]/) ? num : num / 1000;
  // "US" (unstable) or a "?" / "M" (motion) flag means the reading is still settling.
  const stable = !/\bUS\b|\?|\bM\b/i.test(text);
  return { weight: Math.round(sign * kg * 1000) / 1000, stable };
}

/** Splits a stream buffer into complete lines; returns [lines, rest]. */
export function splitLines(buffer) {
  const parts = buffer.split(/\r\n|\r|\n|\x03|\x02/);
  const rest = parts.pop();
  return [parts.filter((p) => p.trim()), rest];
}
