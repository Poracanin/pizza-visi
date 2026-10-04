import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { searchAddresses, resolveAddress } from '../public/ruian-addresses.js';

const data = JSON.parse(await readFile(new URL('../public/data/ruian-addresses.json', import.meta.url)));

test('Canonical RÚIAN selection returns a frozen source-backed address, never arbitrary text', () => {
  const address = resolveAddress(data, '6348416');
  assert.equal(address.label, 'Riegrova 527/50, 252 19 Rudná');
  assert.equal(address.sourceDate, '2026-08-31');
  assert.ok(address.branchIds.includes('rudna'));
  assert.ok(Object.isFrozen(address));
  assert.ok(Object.isFrozen(address.branchIds));
  for (const invalid of ['999999999999', 'Riegrova 527/50, 252 19 Rudná', '6348416x', ' 6348416', '', null, 6348416, { id: '6348416' }]) {
    assert.equal(resolveAddress(data, invalid), null);
  }
});

test('Search accepts diacritics, reordered words, prefixes, house numbers and compact postcodes', () => {
  for (const query of ['Riegrova 527 Rudná', 'rudna 527 rieg', '527 RIEGROVA', '25219 rieg 527', '252 19 riegrova 527']) {
    assert.ok(searchAddresses(data, query).some(address => address.id === '6348416'), query);
  }
  assert.ok(searchAddresses(data, 'HOSTIVICE husovo nám 60').some(address => address.id === '12757250'));
  assert.deepEqual(searchAddresses(data, 'hostivice husovo nam 60'), searchAddresses(data, 'HOSTIVICE HUSOVO NÁM 60'));
  assert.deepEqual(searchAddresses(data, 'neexistujiciulicexyz 999'), []);
  assert.deepEqual(searchAddresses(data, 'r'), []);
  assert.deepEqual(searchAddresses(data, '   '), []);
  assert.ok(searchAddresses(data, 'rieg').length > 0);
  assert.equal(searchAddresses(data, 'rieg', 2).length, 2);
  assert.ok(searchAddresses(data, 'praha', 1000).length <= 20);
  assert.deepEqual(searchAddresses(data, 'rieg', 0), []);
});

test('Coverage keeps both overlapping branches and does not invent Beroun delivery coverage', () => {
  assert.equal(data.count, 16856);
  const overlaps = data.records.filter(row => row[2] === 3);
  assert.equal(overlaps.length, 1818);
  assert.deepEqual(resolveAddress(data, overlaps[0][0]).branchIds, ['rudna', 'hostivice']);
  for (const row of data.records) {
    const address = resolveAddress(data, row[0]);
    assert.ok(address.branchIds.length > 0);
    assert.ok(address.branchIds.every(branch => ['rudna', 'hostivice'].includes(branch)));
  }
  // A prefix may legitimately find Berounská street in a covered municipality.
  assert.ok(data.records.every(row => !/,\s*\d{3}\s?\d{2}\s+Beroun$/.test(row[1])));
  assert.deepEqual(searchAddresses(data, 'Beroun Pivovarska 105'), []);
  assert.equal(data.source.license, 'CC-BY-4.0');
});

test('Malformed projections cannot become canonical address data', () => {
  const invalid = { version: 1, source: { dataDate: '2026-08-31' }, count: 1, records: [['123', 'Made up', 4, '']] };
  assert.throws(() => resolveAddress(invalid, '123'), /neplatnou/);
});
