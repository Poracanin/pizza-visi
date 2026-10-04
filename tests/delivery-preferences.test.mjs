import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalSelection, serializeRememberedSelection, parseRememberedSelection, parseStorageConsent, PREFERENCE_LIFETIME } from '../public/delivery-preferences.js';

const data = { branches: [{ id: 'rudna' }, { id: 'hostivice' }, { id: 'beroun' }] };
const addresses = { version: 1, count: 1, source: { dataDate: '2026-08-31' }, records: [['6348416', 'Riegrova 527/50, 252 19 Rudná', 1, '25219']] };
const selected = { fulfillment: 'delivery', branchId: 'rudna', addressId: '6348416', address: 'untrusted text', name: 'Do not store', phone: '777000000' };
const now = 1791120000000;

test('Remembered delivery restores a canonical ID and never stores free text or contact details', () => {
  const raw = serializeRememberedSelection(selected, data, addresses, now);
  const stored = JSON.parse(raw);
  assert.deepEqual(Object.keys(stored), ['version', 'fulfillment', 'branchId', 'addressId', 'savedAt']);
  const restored = canonicalSelection(parseRememberedSelection(raw, now + 1000), data, addresses);
  assert.equal(restored.address, 'Riegrova 527/50, 252 19 Rudná');
  assert.equal(restored.addressId, selected.addressId);
});

test('Expired, corrupt, uncovered and removed remembered addresses cannot be reused', () => {
  const raw = serializeRememberedSelection(selected, data, addresses, now);
  assert.equal(parseRememberedSelection(raw, now + PREFERENCE_LIFETIME + 1), null);
  assert.equal(parseRememberedSelection(raw, now - 1), null);
  assert.equal(parseRememberedSelection('{broken', now), null);
  assert.equal(canonicalSelection({ ...selected, branchId: 'beroun' }, data, addresses), null);
  assert.equal(canonicalSelection({ ...selected, addressId: '999' }, data, addresses), null);
  assert.throws(() => serializeRememberedSelection({ ...selected, addressId: 'fake' }, data, addresses));
});

test('Pickup stores only a valid branch and consent parsing does not invent approval', () => {
  const raw = serializeRememberedSelection({ ...selected, fulfillment: 'pickup', branchId: 'beroun' }, data, null, now);
  const restored = canonicalSelection(parseRememberedSelection(raw, now), data, null);
  assert.deepEqual(restored, { fulfillment: 'pickup', branchId: 'beroun', addressId: null, address: '' });
  assert.equal(parseStorageConsent(null), null);
  assert.equal(parseStorageConsent('{"mode":"accepted"}'), null);
  assert.equal(parseStorageConsent('{"version":1,"mode":"essential"}'), 'essential');
});
