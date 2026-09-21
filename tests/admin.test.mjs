import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createState, createDemoState, addOrder, transitionOrder, restock, saveRecipe, requirements, restoreState, pizzas} from '../public/admin/model.js';
const site = JSON.parse(fs.readFileSync(new URL('../public/data/site.json', import.meta.url)));
const seed = JSON.parse(fs.readFileSync(new URL('../public/admin/seed.json', import.meta.url)));
const now = '2026-09-21T10:00:00.000Z';
const input = (lines = [{pizzaId: '1-margherita', size: 30, quantity: 2}], overrides = {}) => ({branchId: 'rudna', source: 'wolt', fulfillment: 'pickup', payment: 'online', lines, ...overrides});
const order = (state = createState(site, seed), lines, overrides) => addOrder(state, site, input(lines, overrides), now);

test('Sklad pokrývá 24 pizz, obě velikosti a všechny suroviny v recepturách', () => {
  assert.equal(pizzas(site).length, 24);
  assert.equal(seed.ingredients.length, 32);
  const state = createState(site, seed);
  for (const p of pizzas(site)) for (const size of [30, 40]) {
    assert.ok(state.recipes[p.id][size].testo > 0);
    assert.ok(state.recipes[p.id][size].mozzarella > 0);
    const created = order(state, [{pizzaId: p.id, size, quantity: 1}]);
    assert.ok(requirements(created.state, created.order, seed).every(i => i.needed > 0 && !i.missing));
  }
  assert.doesNotThrow(() => restoreState(JSON.stringify(state), site, seed));
});
test('Potvrzení ani vytvoření objednávky sklad nesnižuje; příprava agreguje velikosti a počty', () => {
  const initial = createState(site, seed);
  const created = order(initial, [{pizzaId: '1-margherita', size: 30, quantity: 2}, {pizzaId: '2-sunkova', size: 40, quantity: 3}]);
  const confirmed = transitionOrder(created.state, created.order.id, 'confirmed', seed, now);
  assert.deepEqual(confirmed.stocks, initial.stocks);
  const expected = 2 * initial.recipes['1-margherita'][30].mozzarella + 3 * initial.recipes['2-sunkova'][40].mozzarella;
  const started = transitionOrder(confirmed, created.order.id, 'preparing', seed, now);
  assert.equal(initial.stocks.rudna.mozzarella - started.stocks.rudna.mozzarella, expected);
  assert.equal(started.movements.length, 1);
  assert.equal(started.orders[0].deduction.amounts.mozzarella, expected);
  assert.deepEqual(started.stocks.beroun, initial.stocks.beroun);
  assert.deepEqual(started.stocks.hostivice, initial.stocks.hostivice);
  assert.deepEqual(confirmed.stocks, initial.stocks);
});
test('Nedostatek souhrnné zásoby neodečte ani jedinou surovinu', () => {
  const created = order(undefined, [{pizzaId: '1-margherita', size: 30, quantity: 2}, {pizzaId: '1-margherita', size: 40, quantity: 2}]);
  created.state.stocks.rudna.mozzarella = 200;
  const before = structuredClone(created.state);
  assert.throws(() => transitionOrder(created.state, created.order.id, 'preparing', seed, now), /Nedostatek surovin.*Mozzarella/);
  assert.deepEqual(created.state, before);
});
test('Opakované zahájení, reload a další stavy už sklad znovu neodečtou', () => {
  const created = order();
  let state = transitionOrder(created.state, created.order.id, 'preparing', seed, now);
  const snapshot = structuredClone(state.stocks);
  assert.equal(transitionOrder(state, created.order.id, 'preparing', seed, now), state);
  state = restoreState(JSON.stringify(state), site, seed);
  state = transitionOrder(state, created.order.id, 'ready', seed, now);
  assert.throws(() => transitionOrder(state, created.order.id, 'preparing', seed, now), /není možný/);
  state = transitionOrder(state, created.order.id, 'completed', seed, now);
  assert.deepEqual(state.stocks, snapshot);
  assert.equal(state.movements.length, 1);
});
test('Naskladnění zvýší jen konkrétní surovinu a pobočku, pak dovolí přípravu', () => {
  const created = order(); created.state.stocks.rudna.mozzarella = 0;
  const updated = restock(created.state, seed, 'rudna', 'mozzarella', 1000, 'Dodávka', now);
  assert.equal(updated.stocks.rudna.mozzarella, 1000);
  assert.equal(updated.stocks.beroun.mozzarella, seed.ingredients.find(i => i.id === 'mozzarella').initial);
  const started = transitionOrder(updated, created.order.id, 'preparing', seed, now);
  assert.equal(started.stocks.rudna.mozzarella, 800);
  assert.equal(started.movements.length, 2);
  for (const amount of [0, -1, 1.5, NaN, Infinity, 10000001]) assert.throws(() => restock(updated, seed, 'rudna', 'mozzarella', amount));
});
test('Změna receptury platí pro novou přípravu, starý odečet zachová původní normu', () => {
  const created = order();
  const started = transitionOrder(created.state, created.order.id, 'preparing', seed, now);
  const changed = saveRecipe(started, site, seed, '1-margherita', 30, {...started.recipes['1-margherita'][30], mozzarella: 125});
  assert.equal(changed.orders[0].deduction.amounts.mozzarella, 200);
  assert.equal(changed.recipes['1-margherita'][40].mozzarella, 165);
  const newOrder = order(changed);
  const next = transitionOrder(newOrder.state, newOrder.order.id, 'preparing', seed, now);
  assert.equal(next.orders[0].deduction.amounts.mozzarella, 250);
  assert.deepEqual(changed.stocks, started.stocks);
});
test('Neplatná nebo prázdná receptura a chybějící normy zabrání přípravě', () => {
  const created = order();
  for (const recipe of [{}, {testo: -1}, {testo: 0}, {testo: 1.5}, {testo: NaN}, {unknown: 200}]) assert.throws(() => saveRecipe(created.state, site, seed, '1-margherita', 30, recipe));
  delete created.state.recipes['1-margherita'][30];
  assert.throws(() => transitionOrder(created.state, created.order.id, 'preparing', seed, now), /Receptura/);
});
test('Zrušení před přípravou nemění sklad, rušení po odečtu je zakázané', () => {
  const created = order();
  const cancelled = transitionOrder(created.state, created.order.id, 'cancelled', seed, now);
  assert.deepEqual(cancelled.stocks, created.state.stocks);
  assert.throws(() => transitionOrder(cancelled, created.order.id, 'preparing', seed, now));
  const started = transitionOrder(created.state, created.order.id, 'preparing', seed, now);
  assert.throws(() => transitionOrder(started, created.order.id, 'cancelled', seed, now));
});
test('Všechny kanály mají stejný skladový režim a ukázková data se obnoví', () => {
  let state = createDemoState(site, seed);
  assert.equal(state.orders.length, 21);
  assert.deepEqual([...new Set(state.orders.map(o => o.source))].sort(), ['bolt', 'foodora', 'pos', 'web', 'wolt']);
  assert.deepEqual(restoreState(JSON.stringify(state), site, seed), state);
  for (const source of ['web', 'wolt', 'foodora', 'bolt', 'pos']) {
    const result = order(createState(site, seed), undefined, {source});
    state = transitionOrder(result.state, result.order.id, 'preparing', seed, now);
    assert.equal(state.orders[0].deduction.amounts.testo, 500);
  }
});
test('Velký platný odběr přes 10 kg přežije opětovné načtení', () => {
  const initial = restock(restock(createState(site, seed), seed, 'rudna', 'mozzarella', 10000), seed, 'rudna', 'drcena-rajcata', 1000);
  const created = order(initial, [{pizzaId: '1-margherita', size: 40, quantity: 20}, {pizzaId: '1-margherita', size: 40, quantity: 20}]);
  const state = transitionOrder(created.state, created.order.id, 'preparing', seed, now);
  assert.ok(state.orders[0].deduction.amounts.testo > 10000);
  assert.doesNotThrow(() => restoreState(JSON.stringify(state), site, seed));
});
test('Nápoje nemění suroviny pro pizzu ani nepřipočítají krabice', () => {
  const created = order(undefined, [{pizzaId: 'nestea-zeleny-caj-0-5l', size: null, quantity: 2}]);
  assert.equal(created.order.total, 100); assert.equal(created.order.packaging, 0);
  const state = transitionOrder(created.state, created.order.id, 'preparing', seed, now);
  assert.deepEqual(state.stocks, created.state.stocks);
  assert.doesNotThrow(() => restoreState(JSON.stringify(state), site, seed));
});
test('Obnovení odmítne poškozený sklad a nesoulad stavů s odečtem', () => {
  const initial = createDemoState(site, seed);
  assert.throws(() => restoreState('{invalid', site, seed));
  const badStock = structuredClone(initial); badStock.stocks.rudna.testo = -1;
  assert.throws(() => restoreState(JSON.stringify(badStock), site, seed));
  const badOrder = structuredClone(initial); badOrder.orders.find(o => o.status === 'preparing').deduction = null;
  assert.throws(() => restoreState(JSON.stringify(badOrder), site, seed));
});
