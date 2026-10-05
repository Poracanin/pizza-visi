import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeLine, basePrice, addonPrice, unitPrice, cartTotals, mergeLine, restoreCart, serializeCart, lineName, lineDetails } from '../public/cart-model.js';
import { editSnapshot, findEditingLine } from '../public/product-route.js';
import { createStorefrontOrder, submitLocalOrder } from '../public/storefront-orders.js';
import { createState, restoreState, requirements, STORAGE_KEY } from '../public/admin/model.js';
const data = JSON.parse(await readFile(new URL('../public/data/site.json', import.meta.url)));
const seed = JSON.parse(await readFile(new URL('../public/admin/seed.json', import.meta.url)));
const [margherita, ham] = data.categories.find(c => c.id === 'pizzy').items;
const now = '2026-10-05T10:00:00.000Z';
const pizza = overrides => normalizeLine(data, { itemId: margherita.id, size: 40, quantity: 1, extras: [], halves: [{ itemId: margherita.id, extras: ['mozzarella'] }, { itemId: ham.id, extras: ['sunka', 'mozzarella'] }], ...overrides });
const request = line => ({ data, cart: [line], fulfillment: 'pickup', branchId: 'rudna', addressId: null, customer: { name: 'Test půlek', phone: '777111222', payment: 'cash' }, idempotencyKey: 'half-pizza-test-request' });

test('40 cm half pizza uses the more expensive base and the 30 cm topping tariff independently on each half', () => {
  const line = pizza({ extras: ['mozzarellove-okraje', 'cesnekova-50g'], quantity: 2 });
  assert.equal(basePrice(data, line), 240);
  assert.equal(addonPrice(data, 'mozzarella', 40, { half: true }), 30);
  assert.equal(addonPrice(data, 'mozzarella', 40), 45);
  assert.equal(unitPrice(data, line), 240 + 30 + 40 + 30 + 80 + 35);
  assert.deepEqual(cartTotals(data, [line], 'delivery'), { subtotal: 910, packaging: 46, delivery: 45, total: 1001, quantity: 2 });
  const sameToppingBothHalves = pizza({ halves: [{ itemId: margherita.id, extras: ['mozzarella'] }, { itemId: ham.id, extras: ['mozzarella'] }] });
  assert.equal(unitPrice(data, sameToppingBothHalves), 240 + 30 + 30);
  const whole = normalizeLine(data, { itemId: ham.id, size: 40, extras: ['mozzarella'] });
  assert.equal(unitPrice(data, whole), 240 + 45);
  assert.equal(cartTotals(data, [sameToppingBothHalves], 'pickup').packaging, 23);
  const expensiveFirst = pizza({ itemId: ham.id, halves: [{ itemId: ham.id, extras: [] }, { itemId: margherita.id, extras: [] }] });
  assert.equal(unitPrice(data, expensiveFirst), 240);
});

test('30 cm half pizzas cannot enter or return to the active cart', () => {
  assert.equal(pizza({ size: 30 }), null);
  const oldLine = { ...pizza(), size: 30 };
  assert.equal(normalizeLine(data, oldLine), null);
  const whole = normalizeLine(data, { itemId: ham.id, size: 30 });
  assert.deepEqual(restoreCart(data, serializeCart([oldLine, whole])), [whole]);
});

test('Both halves are canonical, separate and restricted to pizzas and ingredient toppings', () => {
  const cleaned = pizza({ extras: ['mozzarellove-okraje', 'sunka'], halves: [{ itemId: margherita.id, extras: ['sunka', 'sunka', 'fake'] }, { itemId: ham.id, extras: ['cesnekova-50g', 'mozzarellove-okraje', 'mozzarella'] }] });
  assert.deepEqual(cleaned.extras, ['mozzarellove-okraje']);
  assert.deepEqual(cleaned.halves[0].extras, ['sunka']);
  assert.deepEqual(cleaned.halves[1].extras, ['mozzarella']);
  for (const halves of [null, [], [{}], [{ itemId: ham.id }, { itemId: margherita.id }], [{ itemId: margherita.id }, { itemId: 'coca-cola-0-5l' }], [{ itemId: margherita.id }, { itemId: 'missing' }]]) assert.equal(pizza({ halves }), null);
  assert.equal(pizza({ itemId: 'coca-cola-0-5l' }), null);
});

test('Cart reload and edits keep both halves without retaining private notes or sharing mutable arrays', () => {
  const line = pizza({ note: 'Soukromá poznámka', quantity: 2 });
  const saved = restoreCart(data, serializeCart([line]));
  assert.equal(saved[0].note, '');
  assert.deepEqual(saved[0].halves, line.halves);
  assert.equal(unitPrice(data, saved[0]), unitPrice(data, line));
  let cart = mergeLine([], line);
  cart[0].halves[0].extras.push('sunka');
  assert.deepEqual(line.halves[0].extras, ['mozzarella']);
  cart = mergeLine([line], pizza({ note: line.note }));
  assert.equal(cart[0].quantity, 3);
  const different = pizza({ note: line.note }); different.halves[1].extras = [];
  assert.equal(mergeLine([line], different).length, 2);
  const whole = normalizeLine(data, { itemId: margherita.id, quantity: 1 });
  assert.equal(mergeLine([line], whole).length, 2);
  const snapshot = editSnapshot(line);
  assert.equal(findEditingLine([different, line], snapshot), 1);
  assert.equal(findEditingLine([different], snapshot), -1);
  const edited = mergeLine([line], different, 0);
  assert.deepEqual(edited[0], different);
});

test('Half names and extras remain unambiguous in checkout and receipt', () => {
  const line = pizza({ extras: ['mozzarellove-okraje'] });
  assert.equal(lineName(data, line), '½ Margherita + ½ Šunková');
  assert.deepEqual(lineDetails(data, line), ['1. půlka · Margherita: + Mozzarella', '2. půlka · Šunková: + Mozzarella, Šunka', 'K celé pizze: Mozzarellové okraje']);
});

test('Half order saves to local administration with independent extra names and exact quoted amount', async () => {
  const line = pizza({ size: 40, extras: ['mozzarellove-okraje'], quantity: 2, note: 'Rozkrájet' });
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const result = await submitLocalOrder(request(line), { storage, locks: null, now: () => now, loadSeed: async () => seed });
  assert.equal(result.total, cartTotals(data, [line], 'pickup').total);
  const state = restoreState(values.get(STORAGE_KEY), data, seed);
  const order = state.orders[0];
  assert.equal(order.lines[0].name, '½ Margherita + ½ Šunková');
  assert.deepEqual(order.lines[0].halves[1].extraNames, ['Mozzarella', 'Šunka']);
  assert.equal(order.lines[0].note, 'Rozkrájet');
  assert.equal(order.inventoryIncomplete, true);
  assert.throws(() => requirements(state, order, seed, now), /receptura/);
  const again = await submitLocalOrder(request(line), { storage, locks: null, now: () => now, loadSeed: async () => seed });
  assert.equal(again.orderId, result.orderId);
});

test('Historical plain 30 cm half orders retain their totals and original stock recipe after restoration', () => {
  const line = pizza({ halves: [{ itemId: margherita.id, extras: [] }, { itemId: ham.id, extras: [] }], quantity: 3 });
  const initial = createState(data, seed, now);
  const saved = createStorefrontOrder(initial, request(line), null, now).state;
  Object.assign(saved.orders[0].lines[0], { size: 30, unitPrice: 170 });
  Object.assign(saved.orders[0], { subtotal: 510, packaging: 48, total: 558, inventoryIncomplete: false });
  const state = restoreState(JSON.stringify(saved), data, seed), order = state.orders[0];
  assert.deepEqual(order, saved.orders[0]);
  assert.equal(order.inventoryIncomplete, false);
  const needs = requirements(state, order, seed, now);
  const first = state.recipes[margherita.id][30], second = state.recipes[ham.id][30];
  for (const id of new Set([...Object.keys(first), ...Object.keys(second)])) {
    assert.equal(needs.find(i => i.id === id).needed, Math.ceil(((first[id] || 0) + (second[id] || 0)) * 3 / 2));
  }
  assert.deepEqual(state.stocks, initial.stocks);
});

test('New checkout rejects a tampered 30 cm half even when saved administration contains legacy half orders', async () => {
  const original = pizza();
  const saved = createStorefrontOrder(createState(data, seed, now), request(original), null, now).state;
  // Preserve both the old size and old topping tariff as a historical quote.
  Object.assign(saved.orders[0].lines[0], { size: 30, unitPrice: 270 });
  Object.assign(saved.orders[0], { subtotal: 270, packaging: 16, total: 286 });
  assert.deepEqual(restoreState(JSON.stringify(saved), data, seed).orders[0], saved.orders[0]);
  const values = new Map([[STORAGE_KEY, JSON.stringify(saved)]]);
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const deps = { storage, locks: null, now: () => now, loadSeed: async () => seed };
  await assert.rejects(() => submitLocalOrder({ ...request({ ...original, size: 30 }), idempotencyKey: 'half-invalid-new-request' }, deps), /pouze ve velikosti 40 cm/);
  assert.equal(values.get(STORAGE_KEY), JSON.stringify(saved));
  await submitLocalOrder({ ...request(original), idempotencyKey: 'half-valid-new-request' }, deps);
  const restored = restoreState(values.get(STORAGE_KEY), data, seed);
  assert.deepEqual(restored.orders[1], saved.orders[0]);
  assert.equal(restored.orders[0].lines[0].unitPrice, 340);
});

test('Invalid halves and misplaced add-ons cannot silently change an order during submission', () => {
  for (const change of [line => line.size = 30, line => line.halves.pop(), line => line.halves[1].itemId = 'fake', line => line.halves[1].itemId = 'coca-cola-0-5l', line => line.halves[0].extras.push('cesnekova-50g'), line => line.extras.push('sunka'), line => line.halves[1].extras.push('fake')]) {
    const line = pizza(); change(line);
    const state = createState(data, seed, now);
    assert.throws(() => createStorefrontOrder(state, request(line), null, now));
    assert.equal(state.orders.length, 0);
  }
  const original = pizza();
  const { state } = createStorefrontOrder(createState(data, seed, now), request(original), null, now);
  const changed = pizza(); changed.halves[1].extras = [];
  assert.throws(() => createStorefrontOrder(state, request(changed), null, now), /jinými údaji/);
  const corrupt = structuredClone(state); corrupt.orders[0].lines[0].halves[1].itemId = 'fake';
  assert.throws(() => restoreState(JSON.stringify(corrupt), data, seed), /Půlky/);
});
