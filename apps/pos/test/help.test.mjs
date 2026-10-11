import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const { TOPICS, HELP_GROUPS } = await import(pathToFileURL(path.join(here, '..', 'src', 'help', 'topics.js')).href);
const editions = createRequire(import.meta.url)('../electron/editions.json');

test('help: every topic is complete in Arabic and English, in a known group, with a known feature', () => {
  const ids = new Set();
  for (const x of TOPICS) {
    assert.ok(!ids.has(x.id), `duplicate ${x.id}`);
    ids.add(x.id);
    assert.ok(HELP_GROUPS.includes(x.group), `${x.id}: group`);
    if (x.feature) assert.ok(editions.features[x.feature], `${x.id}: feature ${x.feature}`);
    for (const lang of ['ar', 'en']) {
      const c = x[lang];
      assert.ok(c?.title && c.intro && c.steps?.length && Array.isArray(c.tips), `${x.id}.${lang}`);
    }
    assert.equal(x.ar.steps.length, x.en.steps.length, `${x.id}: same number of steps`);
  }
});
