// Every t('literal.key') used in the UI must exist in both languages, and both
// dictionaries must have the same keys. (Keys built at runtime, like t(`pay.${m}`), are not checked.)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ar = (await import(path.join(root, 'src/i18n/ar.js'))).default;
const en = (await import(path.join(root, 'src/i18n/en.js'))).default;

function usedKeys(dir) {
  const keys = new Set();
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) for (const k of usedKeys(p)) keys.add(k);
    else if (/\.jsx?$/.test(f.name)) for (const m of fs.readFileSync(p, 'utf8').matchAll(/\bt\(\s*['"]([\w.]+)['"]/g)) keys.add(m[1]);
  }
  return keys;
}

test('every UI text key exists in Arabic and English', () => {
  const used = [...usedKeys(path.join(root, 'src'))];
  assert.deepEqual(used.filter((k) => !(k in ar)), [], 'missing in ar.js');
  assert.deepEqual(used.filter((k) => !(k in en)), [], 'missing in en.js');
});

test('Arabic and English dictionaries have the same keys', () => {
  assert.deepEqual(Object.keys(ar).filter((k) => !(k in en)), [], 'only in ar.js');
  assert.deepEqual(Object.keys(en).filter((k) => !(k in ar)), [], 'only in en.js');
});
