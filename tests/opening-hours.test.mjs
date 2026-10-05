import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getOpeningStatus, storeOpeningStatus, countdownText } from '../public/opening-hours.js';
import { createStorefrontOrder, submitLocalOrder } from '../public/storefront-orders.js';
import { createState } from '../public/admin/model.js';
const data = JSON.parse(await readFile(new URL('../public/data/site.json', import.meta.url)));
const seed = JSON.parse(await readFile(new URL('../public/admin/seed.json', import.meta.url)));
const hours = data.branches[0].opening_hours;
const status = time => getOpeningStatus(hours, time);
const request = () => ({ data, cart: [{ itemId: '2-sunkova', size: 30, quantity: 1, extras: [] }], fulfillment: 'pickup', branchId: 'rudna', customer: { name: 'Test hodin', phone: '777111222', payment: 'cash' }, idempotencyKey: 'hours-test-request-001' });

test('Prague opening, closing and both countdown windows have exact inclusive/exclusive boundaries', () => {
  for (const [time, isOpen, countdown, secondsRemaining] of [
    ['2026-10-05T07:59:59Z', false, null, 3601],
    ['2026-10-05T08:00:00Z', false, 'opening', 3600],
    ['2026-10-05T08:59:59Z', false, 'opening', 1],
    ['2026-10-05T09:00:00Z', true, null, 36000],
    ['2026-10-05T16:59:59Z', true, null, 7201],
    ['2026-10-05T17:00:00Z', true, 'closing', 7200],
    ['2026-10-05T18:59:59Z', true, 'closing', 1],
    ['2026-10-05T19:00:00Z', false, null, 50400],
  ]) {
    const result = status(time);
    assert.deepEqual([result.isOpen, result.countdown, result.secondsRemaining], [isOpen, countdown, secondsRemaining], time);
  }
  assert.equal(countdownText(7200), '2:00:00');
  assert.equal(countdownText(3599), '59:59');
  assert.equal(countdownText(1), '00:01');
  assert.equal(countdownText(-1), '00:00');
});

test('Sunday is closed and Saturday evening points to Monday without an early countdown', () => {
  for (const time of ['2026-10-03T19:00:00Z', '2026-10-04T09:00:00Z', '2026-10-04T18:30:00Z']) {
    const result = status(time);
    assert.equal(result.isOpen, false);
    assert.equal(result.countdown, null);
    assert.equal(result.nextOpening, Date.parse('2026-10-05T09:00:00Z'));
  }
  assert.equal(status('2026-10-03T19:00:00Z').detail, 'Otevíráme v pondělí v 11:00');
  assert.equal(status('2026-10-04T23:00:00Z').detail, 'Otevíráme dnes v 11:00');
});

test('Summer/winter time and weekends crossing DST resolve the correct Prague opening instant', () => {
  assert.equal(status('2026-01-05T09:59:59Z').isOpen, false);
  assert.equal(status('2026-01-05T10:00:00Z').isOpen, true);
  assert.equal(status('2026-07-06T09:00:00Z').isOpen, true);
  assert.equal(status('2026-03-28T20:00:00Z').nextOpening, Date.parse('2026-03-30T09:00:00Z'));
  assert.equal(status('2026-10-24T19:00:00Z').nextOpening, Date.parse('2026-10-26T10:00:00Z'));
});

test('Availability uses branch configuration and fails closed for missing or invalid schedules', () => {
  for (const branch of data.branches) assert.equal(storeOpeningStatus(data, '2026-10-05T10:00:00Z', branch.id).isOpen, true);
  const changed = structuredClone(data); changed.branches[1].opening_hours.opens = '14:00';
  assert.equal(storeOpeningStatus(changed, '2026-10-05T10:00:00Z', 'hostivice').isOpen, false);
  assert.equal(storeOpeningStatus(changed, '2026-10-05T10:00:00Z', 'rudna').isOpen, true);
  assert.equal(storeOpeningStatus(changed, '2026-10-05T10:00:00Z', 'missing').isOpen, false);
  for (const schedule of [null, {}, { ...hours, opens: 'bad' }, { ...hours, days: [] }]) assert.equal(getOpeningStatus(schedule, '2026-10-05T10:00:00Z').isOpen, false);
});

test('Closed orders cannot be saved, while an already accepted order stays safely idempotent after closing', () => {
  const initial = createState(data, seed);
  for (const time of ['2026-10-05T08:59:59Z', '2026-10-05T19:00:00Z', '2026-10-04T12:00:00Z']) {
    assert.throws(() => createStorefrontOrder(initial, request(), null, time), /zavřeno/);
    assert.equal(initial.orders.length, 0);
  }
  const saved = createStorefrontOrder(initial, request(), null, '2026-10-05T18:59:59Z');
  const retry = createStorefrontOrder(saved.state, request(), null, '2026-10-05T19:00:01Z');
  assert.equal(retry.duplicate, true);
  assert.equal(retry.order.id, saved.order.id);
  assert.equal(retry.state.orders.length, 1);
});

test('Closing while waiting for the persistence lock rejects the order without touching stored data', async () => {
  let now = '2026-10-05T18:59:59Z', writes = 0;
  const storage = { getItem: () => null, setItem: () => { writes++; } };
  const locks = { request: async (key, save) => { now = '2026-10-05T19:00:00Z'; return save(); } };
  await assert.rejects(() => submitLocalOrder(request(), { storage, locks, now: () => now, loadSeed: async () => seed }), /zavřeno/);
  assert.equal(writes, 0);
});
