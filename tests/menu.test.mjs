import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { itemPrice, matchesItem, validBranch } from '../public/menu-utils.js';

const data = JSON.parse(await readFile(new URL('../public/data/site.json', import.meta.url)));
const pizza = data.categories.find(category => category.id === 'pizzy').items;

test('Všech 24 pizz má původní ceny pro obě velikosti a existující fotografii', async () => {
  assert.equal(pizza.length, 24);
  for (const item of pizza) {
    assert.equal(item.prices.length, 2);
    assert.equal(itemPrice(item, 30), item.prices.find(p => p.diameter_cm === 30).price_czk);
    assert.equal(itemPrice(item, 40), item.prices.find(p => p.diameter_cm === 40).price_czk);
    assert.ok(itemPrice(item, 40) > itemPrice(item, 30));
    await access(new URL('../public/' + item.image, import.meta.url));
  }
  assert.equal(itemPrice(pizza[0], 30), 150);
  assert.equal(itemPrice(pizza[0], 40), 220);
  assert.equal(itemPrice(pizza[23], 40), 290);
});

test('Hledání funguje bez diakritiky a kombinovaně s filtry', () => {
  assert.equal(matchesItem(pizza[1], 'sunkova'), true);
  assert.equal(matchesItem(pizza[5], 'syrova', 'cream'), true);
  assert.equal(matchesItem(pizza[5], 'syrova', 'tomato'), false);
  assert.equal(matchesItem(pizza[17], 'OHNIVA', 'spicy'), true);
  assert.equal(matchesItem(pizza[0], '', 'spicy'), false);
  assert.equal(matchesItem(pizza[0], 'neexistujici'), false);
});

test('Všechny kategorie obsahují 69 položek s cenou; soubory fotografií existují', async () => {
  const all = data.categories.flatMap(category => category.items);
  assert.equal(all.length, 69);
  assert.equal(new Set(all.map(item => item.id)).size, 69);
  for (const item of all) {
    assert.ok(Number.isFinite(itemPrice(item, 30)) && itemPrice(item, 30) > 0);
    if (item.image) await access(new URL('../public/' + item.image, import.meta.url));
  }
});

test('Každá pobočka má vlastní správný telefon, lokality a fotografii', async () => {
  assert.deepEqual(data.branches.map(branch => branch.id), ['rudna', 'hostivice', 'beroun']);
  const phones = { rudna: 'tel:+420606918942', hostivice: 'tel:+420606518565', beroun: 'tel:+420737857493' };
  for (const branch of data.branches) {
    assert.equal(validBranch(data.branches, branch.id).phone_uri, phones[branch.id]);
    assert.ok(branch.delivery_areas.length >= 7);
    await access(new URL('../public/' + branch.image, import.meta.url));
  }
  assert.equal(validBranch(data.branches, 'praha'), null);
  assert.equal(validBranch(data.branches, undefined), null);
});
