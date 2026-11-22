import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSparc } from '../gravity/sparc.js';
import { galaxyFromSearch } from '../gravity/real-link.js';

const data = await loadSparc(new URL('../gravity/sparc-data.json', import.meta.url));

test('deep links resolve measured examples to canonical catalogue IDs', () => {
  for (const name of ['DDO154', 'NGC2403', 'NGC3198', 'NGC2841', 'UGC02885']) {
    assert.equal(galaxyFromSearch(data, `?galaxy=${name}`), name);
  }
  assert.equal(galaxyFromSearch(data, '?galaxy=NGC%202403'), 'NGC2403');
  assert.equal(galaxyFromSearch(data, '?galaxy=ugc+2885'), 'UGC02885');
  assert.equal(galaxyFromSearch(data, '?from=film&galaxy=ddo_154'), 'DDO154');
});

test('missing, unknown and hostile query names leave the normal default available', () => {
  for (const search of ['', '?galaxy=', '?galaxy=not-a-galaxy', '?galaxy=%E0%A4%A',
    '?galaxy=%3Cscript%3Ealert(1)%3C%2Fscript%3E', '?galaxy=https%3A%2F%2Fexample.com%2Fdata.json']) {
    assert.equal(galaxyFromSearch(data, search), null, search);
  }
});

test('query parameters cannot override catalogue measurements or add entries', () => {
  const before = structuredClone(data);
  assert.equal(galaxyFromSearch(data, '?galaxy=DDO154&Vobs=999&profile=bogus&galaxy=NGC2403'), 'DDO154');
  assert.deepEqual(data, before);
});
