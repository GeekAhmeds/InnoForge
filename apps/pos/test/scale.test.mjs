import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScaleLine, splitLines } from '../src/lib/scale-parse.js';

test('scale lines from common protocols', () => {
  assert.deepEqual(parseScaleLine('ST,GS,+  1.250kg'), { weight: 1.25, stable: true });
  assert.deepEqual(parseScaleLine('US,GS,+  1.180kg'), { weight: 1.18, stable: false });
  assert.deepEqual(parseScaleLine('   0.455 kg'), { weight: 0.455, stable: true });
  assert.deepEqual(parseScaleLine('W+001250g'), { weight: 1.25, stable: true });
  assert.deepEqual(parseScaleLine('001250'), { weight: 1.25, stable: true });
  assert.deepEqual(parseScaleLine('2,5'), { weight: 2.5, stable: true });
  assert.equal(parseScaleLine('ERR'), null);
  assert.deepEqual(splitLines('1.2kg\r\n1.3kg\r\n1.4'), [['1.2kg', '1.3kg'], '1.4']);
});
