import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeLine, unitPrice, lineDetails, lineKey, mergeLine, restoreCart, serializeCart } from '../public/cart-model.js';
import { recipeBase, removableIngredients, hasRecipeChanges, removalChoices, setIngredientRemoval } from '../public/pizza-customization.js';
import { createStorefrontOrder, submitLocalOrder } from '../public/storefront-orders.js';
import { createState, restoreState, requirements, STORAGE_KEY } from '../public/admin/model.js';
import { editSnapshot, findEditingLine } from '../public/product-route.js';
const data = JSON.parse(await readFile(new URL('../public/data/site.json', import.meta.url)));
const seed = JSON.parse(await readFile(new URL('../public/admin/seed.json', import.meta.url)));
const [margherita, ham, , mushroom] = data.categories.find(c => c.id === 'pizzy').items;
const now = '2026-10-05T10:00:00.000Z';
const whole = options => normalizeLine(data, { itemId: margherita.id, size: 40, quantity: 1, extras: [], ...options });
const half = options => whole({ halves: [{ itemId: margherita.id, extras: [], base: 'cream', removedIngredients: ['oregano'] }, { itemId: ham.id, extras: ['mozzarella'], removedIngredients: ['šunka – prosciutto cotto'] }], ...options });
const request = line => ({ data, cart: [line], fulfillment: 'pickup', branchId: 'rudna', customer: { name: 'Test úpravy', phone: '777111222', payment: 'cash' }, idempotencyKey: 'recipe-options-test-request' });

test('Default recipes remain compatible; both base swaps and removals are free at either size', () => {
  for (const size of [30, 40]) {
    const plain = whole({ size });
    assert.deepEqual(whole({ size, base: 'tomato', removedIngredients: [] }), plain);
    const changed = whole({ size, base: 'cream', removedIngredients: ['oregano', 'mozzarella', 'oregano'] });
    assert.equal(unitPrice(data, changed), unitPrice(data, plain));
    assert.deepEqual(changed.removedIngredients, ['mozzarella', 'oregano']);
    assert.equal(unitPrice(data, half({ size })), size === 40 ? 240 + 45 : 170 + 30);
  }
  assert.equal(recipeBase(mushroom), 'cream');
  assert.equal(recipeBase(data.categories.find(c => c.id === 'pizzy').items.find(item => item.id === '19-zeleninova')), 'cream');
  assert.deepEqual(removableIngredients(margherita), ['drcená rajčata', 'mozzarella', 'oregano']);
  const original = whole();
  assert.equal(lineKey(original), JSON.stringify([original.itemId, 40, [], '']));
});

test('Unknown bases, ingredients from another recipe and changes on drinks are rejected', () => {
  for (const options of [{ base: 'fake' }, { base: null }, { removedIngredients: ['salám pepperoni'] }, { removedIngredients: 'oregano' }, { base: 'cream', removedIngredients: ['drcená rajčata'] }]) assert.equal(whole(options), null);
  assert.equal(half({ base: 'cream' }), null);
  assert.equal(half({ removedIngredients: ['oregano'] }), null);
  const wrongHalf = half(); wrongHalf.halves[0].removedIngredients = ['šunka – prosciutto cotto'];
  assert.equal(normalizeLine(data, wrongHalf), null);
  assert.equal(normalizeLine(data, { itemId: 'coca-cola-0-5l', base: 'cream' }), null);
});

const lookup = id => data.categories.find(c => c.id === 'pizzy').items.find(item => item.id === id);
test('One combined list removes shared ingredients from both halves and unique ingredients only where present', () => {
  const line = whole({ halves: [{ itemId: margherita.id, extras: [] }, { itemId: ham.id, extras: [] }] });
  const choices = removalChoices(line, lookup);
  assert.deepEqual(choices.map(choice => choice.ingredient), ['drcená rajčata', 'mozzarella', 'oregano', 'šunka – prosciutto cotto']);
  assert.equal(choices.find(choice => choice.ingredient === 'mozzarella').targets.length, 2);
  assert.equal(setIngredientRemoval(line, lookup, 'mozzarella', true), true);
  assert.equal(setIngredientRemoval(line, lookup, 'šunka – prosciutto cotto', true), true);
  assert.deepEqual(line.halves[0].removedIngredients, ['mozzarella']);
  assert.deepEqual(line.halves[1].removedIngredients, ['mozzarella', 'šunka – prosciutto cotto']);
  assert.equal(setIngredientRemoval(line, lookup, 'salám pepperoni', true), false);
  assert.equal(unitPrice(data, line), 240);
  assert.deepEqual(restoreCart(data, serializeCart([line])), [line]);
  const { state, order } = createStorefrontOrder(createState(data, seed), request(line), null, now);
  assert.deepEqual(restoreState(JSON.stringify(state), data, seed).orders[0].lines[0].halves.map(part => part.removedIngredients), line.halves.map(part => part.removedIngredients));
  assert.equal(order.total, 263);
  setIngredientRemoval(line, lookup, 'mozzarella', false);
  assert.equal(line.halves[0].removedIngredients, undefined);
  assert.deepEqual(line.halves[1].removedIngredients, ['šunka – prosciutto cotto']);
});

test('Previously saved one-half omissions remain mixed until explicitly changed in the combined list', () => {
  const line = half();
  let oregano = removalChoices(line, lookup).find(choice => choice.ingredient === 'oregano');
  assert.equal(oregano.mixed, true);
  assert.equal(oregano.checked, false);
  assert.deepEqual(line.halves[1].removedIngredients, ['šunka – prosciutto cotto']);
  setIngredientRemoval(line, lookup, 'oregano', true);
  oregano = removalChoices(line, lookup).find(choice => choice.ingredient === 'oregano');
  assert.equal(oregano.mixed, false);
  assert.equal(oregano.checked, true);
  setIngredientRemoval(line, lookup, 'oregano', false);
  assert.equal(removalChoices(line, lookup).find(choice => choice.ingredient === 'oregano').removed, 0);
});

test('The combined list includes actual bases and merges case variants without losing per-half spelling', () => {
  const vegetables = lookup('19-zeleninova');
  const line = normalizeLine(data, { itemId: mushroom.id, size: 30, halves: [{ itemId: mushroom.id, extras: [] }, { itemId: vegetables.id, extras: [] }] });
  const creams = removalChoices(line, lookup).filter(choice => choice.ingredient.toLowerCase().includes('smetana'));
  assert.equal(creams.length, 1);
  assert.equal(creams[0].targets.length, 2);
  setIngredientRemoval(line, lookup, creams[0].ingredient, true);
  assert.deepEqual(line.halves.map(part => part.removedIngredients), [['smetana (halta)'], ['Smetana (halta)']]);
  assert.deepEqual(normalizeLine(data, line), line);
  const explicitDefault = normalizeLine(data, { itemId: vegetables.id, size: 30, base: 'cream', removedIngredients: ['Smetana (halta)'] });
  assert.deepEqual(normalizeLine(data, explicitDefault), explicitDefault);
  const swapped = whole({ base: 'cream' });
  assert.equal(removalChoices(swapped, lookup)[0].ingredient, 'smetana (halta)');
  setIngredientRemoval(swapped, lookup, 'smetana (halta)', true);
  assert.deepEqual(normalizeLine(data, swapped), swapped);
  assert.equal(unitPrice(data, swapped), 220);
});

test('Each recipe stays distinct in cart merging, editing and browser persistence', () => {
  const original = whole(), cream = whole({ base: 'cream' }), noCheese = whole({ removedIngredients: ['mozzarella'] });
  let cart = [original, cream, noCheese, half()];
  assert.equal(mergeLine(cart, cream).length, 4);
  assert.equal(mergeLine(cart, cream)[1].quantity, 2);
  assert.equal(findEditingLine(cart, editSnapshot(noCheese)), 2);
  assert.deepEqual(restoreCart(data, serializeCart(cart)), cart);
  const saved = mergeLine([], half());
  saved[0].halves[0].removedIngredients.push('mozzarella');
  assert.deepEqual(half().halves[0].removedIngredients, ['oregano']);
  const swapped = half();
  swapped.halves[1].base = 'cream';
  assert.notEqual(lineKey(swapped), lineKey(half()));
});

test('Cart, checkout and receipt details identify the correct base and removed ingredients per half', () => {
  assert.deepEqual(lineDetails(data, whole({ base: 'cream', removedIngredients: ['oregano'] })), ['Smetanový základ', 'Bez: oregano']);
  assert.deepEqual(lineDetails(data, half()), [
    '1. půlka · Margherita: Smetanový základ · Bez: oregano',
    '2. půlka · Šunková: Bez: šunka – prosciutto cotto · + Mozzarella',
  ]);
});

test('Local order retains recipe changes after reload and duplicate submission without changing totals', async () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const line = half();
  const result = await submitLocalOrder(request(line), { storage, locks: null, now: () => now, loadSeed: async () => seed });
  const state = restoreState(values.get(STORAGE_KEY), data, seed);
  const order = state.orders[0];
  assert.equal(order.configurationVersion, 3);
  assert.equal(order.total, 240 + 45 + 23);
  assert.equal(result.total, order.total);
  assert.equal(order.lines[0].halves[0].base, 'cream');
  assert.deepEqual(order.lines[0].halves[1].removedIngredients, ['šunka – prosciutto cotto']);
  assert.equal((await submitLocalOrder(request(line), { storage, locks: null, now: () => now, loadSeed: async () => seed })).orderId, result.orderId);
  const changed = half(); delete changed.halves[0].base;
  assert.throws(() => createStorefrontOrder(state, request(changed), null, now), /jinými údaji/);
  const corrupted = structuredClone(state); corrupted.orders[0].lines[0].halves[0].base = 'fake';
  assert.throws(() => restoreState(JSON.stringify(corrupted), data, seed), /Základ/);
});

test('Modified recipes never consume the original stock recipe, including tampered inventory flags', () => {
  for (const line of [whole({ size: 30, base: 'cream' }), whole({ size: 30, removedIngredients: ['mozzarella'] }), half({ size: 30 })]) {
    const { state, order } = createStorefrontOrder(createState(data, seed), request(line), null, now);
    assert.equal(order.inventoryIncomplete, true);
    assert.equal(hasRecipeChanges(order.lines[0]), true);
    order.inventoryIncomplete = false;
    assert.throws(() => requirements(state, order, seed), /receptura/);
    assert.equal(restoreState(JSON.stringify(state), data, seed).orders[0].inventoryIncomplete, true);
  }
});
