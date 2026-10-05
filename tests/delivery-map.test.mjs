import test from 'node:test';
import assert from 'node:assert/strict';
import { filterDeliveryAreas } from '../public/delivery-map.js';

const areas = [
  { properties: { name: 'Rudná', branchIds: ['rudna'] } },
  { properties: { name: 'Praha – Zličín', branchIds: ['rudna', 'hostivice'] } },
  { properties: { name: 'Hostivice', branchIds: ['hostivice'] } },
  { properties: { name: 'Beroun', branchIds: ['beroun'] } }
];

test('shared Zličín remains visible for both branches without duplicating the all-branches area', () => {
  assert.deepEqual(filterDeliveryAreas(areas, 'rudna').map((area) => area.properties.name), ['Rudná', 'Praha – Zličín']);
  assert.deepEqual(filterDeliveryAreas(areas, 'hostivice').map((area) => area.properties.name), ['Praha – Zličín', 'Hostivice']);
  assert.deepEqual(filterDeliveryAreas(areas, 'beroun').map((area) => area.properties.name), ['Beroun']);
  assert.equal(filterDeliveryAreas(areas).filter((area) => area.properties.name === 'Praha – Zličín').length, 1);
  assert.equal(areas.length, 4);
});
