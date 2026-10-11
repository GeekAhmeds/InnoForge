// Barcode symbols as inline SVG: EAN-13 for valid 13-digit codes, Code 128 (set B) otherwise.
// Both are read by every common retail scanner.

const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const EAN_G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const EAN_R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const EAN_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

export function eanCheckDigit(d12) {
  const sum = [...d12].reduce((s, c, i) => s + Number(c) * (i % 2 ? 3 : 1), 0);
  return String((10 - (sum % 10)) % 10);
}

export const isEan13 = (code) => /^\d{13}$/.test(code) && eanCheckDigit(code.slice(0, 12)) === code[12];

function ean13Bits(code) {
  const parity = EAN_PARITY[Number(code[0])];
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (parity[i - 1] === 'L' ? EAN_L : EAN_G)[Number(code[i])];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += EAN_R[Number(code[i])];
  return `${bits}101`;
}

// Code 128 bar/space widths for values 0..106 (106 = stop, which has an extra bar).
const C128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

function code128Bits(text) {
  const chars = [...String(text)].filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126);
  const values = [104, ...chars.map((c) => c.charCodeAt(0) - 32)];
  const check = values.reduce((s, v, i) => s + v * (i || 1), 0) % 103;
  values.push(check, 106);
  let bits = '';
  for (const v of values) {
    [...C128[v]].forEach((w, i) => { bits += (i % 2 ? '0' : '1').repeat(Number(w)); });
  }
  return bits;
}

/** Returns an SVG string; `height` in px of the bars, text printed under them. */
export function barcodeSvg(code, { height = 40, module = 1.6, showText = true } = {}) {
  const value = String(code || '');
  const ean = isEan13(value);
  const bits = ean ? ean13Bits(value) : code128Bits(value);
  const quiet = 10 * module;
  const width = bits.length * module + quiet * 2;
  let rects = '';
  let x = quiet;
  for (let i = 0; i < bits.length; ) {
    let run = 1;
    while (bits[i + run] === bits[i]) run++;
    if (bits[i] === '1') rects += `<rect x="${x.toFixed(2)}" y="0" width="${(run * module).toFixed(2)}" height="${height}"/>`;
    x += run * module;
    i += run;
  }
  const textH = showText ? 13 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width.toFixed(2)} ${height + textH}" preserveAspectRatio="none">`
    + `<rect width="100%" height="100%" fill="#fff"/><g fill="#000">${rects}</g>`
    + (showText ? `<text x="${width / 2}" y="${height + 11}" font-family="monospace" font-size="11" text-anchor="middle">${value.replace(/[<&>]/g, '')}</text>` : '')
    + '</svg>';
}
