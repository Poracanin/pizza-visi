import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeLine, mergeLine } from '../public/cart-model.js';
import { productHash, parseProductRoute, editSnapshot, findEditingLine } from '../public/product-route.js';

const data = JSON.parse(await readFile(new URL('../public/data/site.json', import.meta.url)));
const pizza = data.categories.find(category => category.id === 'pizzy').items[0];
const line = options => normalizeLine(data, { itemId: pizza.id, size: 30, quantity: 1, ...options });

test('Editor links round-trip a selected pizza size without treating menu anchors as routes', () => {
  assert.deepEqual(parseProductRoute(productHash(pizza.id, 40), data), { itemId: pizza.id, size: 40 });
  assert.deepEqual(parseProductRoute(productHash(pizza.id, 30), data), { itemId: pizza.id, size: 30 });
  assert.deepEqual(parseProductRoute(`#upravit/${pizza.id}`, data), { itemId: pizza.id, size: 30 });
  assert.deepEqual(parseProductRoute(`#upravit/${pizza.id}?size=999`, data), { itemId: pizza.id, size: 30 });
  assert.equal(parseProductRoute('#menu', data), null);
  assert.equal(parseProductRoute('#pribeh', data), null);
});

test('Broken, unknown and packaging routes cannot create an editable product', () => {
  for (const hash of ['#upravit', '#upravit/', '#upravit/%E0%A4%A', '#upravit/not-a-product', '#upravit/pizza-krabice', '#upravit/mozzarella', '#upravit/mozzarellove-okraje', '#upravit/cesnekova-50g', '#upravit/id/extra']) {
    assert.deepEqual(parseProductRoute(hash, data), { invalid: true }, hash);
  }
});

test('Cart edits follow the original configuration when another line is removed or merged', () => {
  const original = line({ size: 40, extras: ['mozzarella', 'sunka'], note: 'Rozkrájet', quantity: 2 });
  const snapshot = editSnapshot(original);
  const unrelated = line({ size: 30 });
  const drink = normalizeLine(data, { itemId: 'coca-cola-0-5l', quantity: 1 });
  assert.equal(findEditingLine([unrelated, original], snapshot), 1);
  assert.equal(findEditingLine([original], snapshot), 0);
  const cartAfterQuickAdd = mergeLine([unrelated, original], drink);
  const edited = line({ size: 40, extras: ['mozzarella'], note: 'Rozkrájet', quantity: 3 });
  const result = mergeLine(cartAfterQuickAdd, edited, findEditingLine(cartAfterQuickAdd, snapshot));
  assert.equal(result.length, 3);
  assert.deepEqual(result.find(entry => entry.note === 'Rozkrájet'), edited);
  assert.deepEqual(result.find(entry => entry.itemId === drink.itemId), drink);
});

test('Removed or changed cart lines cannot be overwritten through a stale edit index', () => {
  const original = line({ note: 'Bez krájení', quantity: 2, extras: ['mozzarella'] });
  const snapshot = editSnapshot(original);
  assert.equal(findEditingLine([line({ size: 40 })], snapshot), -1);
  for (const change of [{ quantity: 3 }, { note: 'Rozkrájet' }, { size: 40 }, { extras: ['sunka'] }]) {
    assert.equal(findEditingLine([{ ...original, ...change }], snapshot), -1);
  }
  assert.equal(findEditingLine([original, { ...original }], snapshot), -1, 'ambiguous duplicates are rejected');
  assert.equal(findEditingLine([original], null), -1);
});
