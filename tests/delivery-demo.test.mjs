import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { matchDeliveryBranch } from '../public/delivery-demo.js';

const { branches } = JSON.parse(await readFile(new URL('../public/data/site.json', import.meta.url)));
const match = address => matchDeliveryBranch(address, branches);

test('Demo vybírá správnou pobočku z adresy i bez diakritiky', () => {
  for (const [address, id] of [
    ['Riegerova 527/50, Rudná (u Prahy)', 'rudna'],
    ['HUSOVO NAMESTI 60, HOSTIVICE', 'hostivice'],
    ['Pivovarská 105/11, 266 01 Beroun', 'beroun'],
    ['  Hostivice  ', 'hostivice'],
  ]) assert.deepEqual(match(address), { status: 'matched', branchIds: [id] });
});

test('Demo zná okolní obce a různé zápisy pražských čtvrtí', () => {
  for (const [address, id] of [
    ['Nučice', 'rudna'], ['Vysoky Ujezd', 'rudna'],
    ['Praha 6, Ruzyne', 'hostivice'], ['Praha – Řepy', 'hostivice'],
    ['Praha-Třebonice', 'rudna'], ['Králův Dvůr', 'beroun'],
    ['Červený Újezd', 'hostivice'],
  ]) assert.deepEqual(match(address), { status: 'matched', branchIds: [id] });
});

test('Společná lokalita nebo protichůdné obce se nevybírají náhodně', () => {
  for (const address of ['Praha-Zličín', 'Praha – Zličín', 'Zlicin', 'Rudná, Hostivice']) {
    assert.deepEqual(match(address), { status: 'ambiguous', branchIds: ['rudna', 'hostivice'] });
  }
});

test('Neznámá adresa, samotná ulice ani část názvu nepotvrdí rozvoz', () => {
  for (const address of ['Berounská 10, Praha', 'Hostivická 60', 'Pivovarská 105/11', 'Praha', 'Brno', '266 01', 'Újezd']) {
    assert.deepEqual(match(address), { status: 'unknown', branchIds: [] });
  }
  assert.deepEqual(match('   '), { status: 'empty', branchIds: [] });
  assert.deepEqual(match(',,,'), { status: 'empty', branchIds: [] });
});
