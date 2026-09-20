import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeLine, unitPrice, cartTotals, mergeLine, restoreCart, serializeCart, MAX_QUANTITY } from '../public/cart-model.js';
const data = JSON.parse(await readFile(new URL('../public/data/site.json', import.meta.url)));
const pizza = data.categories.find(c => c.id === 'pizzy').items[0];
const line = options => normalizeLine(data, { itemId: pizza.id, size: 30, quantity: 1, ...options });

test('Ceny přísad, okrajů a omáček se přepočítají podle velikosti', () => {
  const extras = ['mozzarella', 'mozzarellove-okraje', 'cesnekova-50g'];
  assert.equal(unitPrice(data, line({ extras })), 150 + 30 + 60 + 35);
  assert.equal(unitPrice(data, line({ size: 40, extras })), 220 + 45 + 80 + 35);
});
test('Dvě upravené pizzy: přísady za kus, krabice za kus a rozvoz jednou', () => {
  const cart = [line({ size: 40, quantity: 2, extras: ['mozzarella', 'mozzarellove-okraje', 'cesnekova-50g'] })];
  assert.deepEqual(cartTotals(data, cart, 'delivery'), { subtotal: 760, packaging: 46, delivery: 45, total: 851, quantity: 2 });
  assert.equal(cartTotals(data, cart, 'pickup').total, 806);
  const drink = normalizeLine(data, { itemId: 'coca-cola-0-5l', quantity: 1 });
  assert.equal(cartTotals(data, [...cart, drink], 'delivery').total, 901);
});
test('Prázdný košík nemá poplatek a nápoje nedostávají krabici na pizzu', () => {
  assert.deepEqual(cartTotals(data, [], 'delivery'), { subtotal: 0, packaging: 0, delivery: 0, total: 0, quantity: 0 });
  const drinks = [normalizeLine(data, { itemId: 'coca-cola-0-5l', quantity: 3 })];
  assert.equal(cartTotals(data, drinks, 'pickup').total, 150);
  assert.equal(cartTotals(data, drinks, 'delivery').packaging, 0);
});
test('Stejné konfigurace se sloučí, různé velikosti, přílohy a poznámky zůstanou oddělené', () => {
  let cart = mergeLine([], line({ extras: ['mozzarella', 'sunka'] }));
  cart = mergeLine(cart, line({ extras: ['sunka', 'mozzarella'], quantity: 2 }));
  assert.equal(cart.length, 1); assert.equal(cart[0].quantity, 3);
  cart = mergeLine(cart, line({ size: 40 }));
  cart = mergeLine(cart, line({ note: 'Rozkrájet' }));
  assert.equal(cart.length, 3);
  const edited = mergeLine(cart, line({ size: 40, quantity: 2 }), 0);
  assert.equal(edited.length, 2); assert.equal(edited.find(l => l.size === 40).quantity, 3);
  assert.equal(cart[0].quantity, 3, 'úpravy nemutují původní košík');
});
test('Obnovený košík ignoruje neplatné položky, podvržené ceny a osobní poznámky', () => {
  const restored = restoreCart(data, JSON.stringify({ version: 1, lines: [
    { itemId: pizza.id, size: 40, quantity: 2, extras: ['mozzarella', 'mozzarella', 'fake', pizza.id], note: 'soukromá poznámka', price: 1 },
    { itemId: 'fake', quantity: 1 }, { itemId: 'pizza-krabice', quantity: 1 }
  ] }));
  assert.equal(restored.length, 1); assert.equal(restored[0].note, '');
  assert.deepEqual(restored[0].extras, ['mozzarella']);
  assert.equal(unitPrice(data, restored[0]), 265);
  assert.deepEqual(restoreCart(data, '{invalid'), []);
  assert.deepEqual(restoreCart(data, '{"version":2,"lines":[]}'), []);
  assert.ok(!serializeCart([line({ note: 'soukromá poznámka' })]).includes('soukromá'));
});
test('Počty jsou omezené a nápoj nemůže mít pizza příplatky', () => {
  assert.equal(line({ quantity: -1 }).quantity, 1);
  assert.equal(line({ quantity: 200 }).quantity, MAX_QUANTITY);
  assert.equal(line({ quantity: 2.9 }).quantity, 2);
  assert.equal(mergeLine([line({ quantity: 19 })], line({ quantity: 2 }))[0].quantity, MAX_QUANTITY);
  const drink = normalizeLine(data, { itemId: 'coca-cola-0-5l', size: 40, extras: ['mozzarella'] });
  assert.equal(drink.size, null); assert.deepEqual(drink.extras, []);
});
