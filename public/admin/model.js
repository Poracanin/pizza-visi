import {stockSummary, makeInitialBatches, addBatch, allocateBatches, validateBatches} from './inventory.js';
import {deliveryAssignment, removeDeliveryOrder, validateDeliveryPlans, platformCourier, migrateCourierPolicy} from './delivery.js?v=bb45e9a7';
// Amounts are whole grams or millilitres. Mutations are pure: one complete state
// is persisted only after the entire operation succeeds.
export const SOURCES = ['web', 'pos', 'wolt', 'foodora', 'bolt'];
export const STATUSES = ['new', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled'];
export const STORAGE_KEY = 'pizza-visi-pos-demo-v1';
const clone = value => structuredClone(value);
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const fail = message => { throw new Error(message); };
export const pizzas = site => site.categories.find(c => c.id === 'pizzy').items;
export const products = site => site.categories.filter(c => ['pizzy', 'napoje', 'vino-prosecco'].includes(c.id)).flatMap(c => c.items.map(i => ({...i, category: c.id})));
export const pizzaName = item => item.name.replace(/^\d+\.\s*/, '');
export function validateRecipe(recipe, seed) {
  if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) fail('Receptura není platná.');
  const entries = Object.entries(recipe);
  if (!entries.length) fail('Receptura musí mít alespoň jednu surovinu.');
  for (const [id, amount] of entries) {
    if (!seed.ingredients.some(i => i.id === id) || !integer(amount, 1, 10000)) fail('Vyplňte celá množství od 1 do 10 000 g/ml.');
  }
  return true;
}
export function createState(site, seed, now = new Date().toISOString()) {
  const state = {version: 2, courierPolicyVersion: 1, revision: 0, sequence: 1040, recipes: clone(seed.recipes), stocks: {}, orders: [], movements: []};
  for (const branch of site.branches) state.stocks[branch.id] = Object.fromEntries(seed.ingredients.map(i => [i.id, i.initial]));
  for (const recipe of Object.values(state.recipes)) delete recipe[40];
  makeInitialBatches(state, seed, now);
  return state;
}
export function addOrder(state, site, input, now = new Date().toISOString()) {
  if (!Object.hasOwn(state.stocks, input.branchId) || !SOURCES.includes(input.source)) fail('Vyberte pobočku a zdroj objednávky.');
  if (!['pickup', 'delivery'].includes(input.fulfillment) || !['cash', 'card', 'online'].includes(input.payment)) fail('Vyberte předání a platbu.');
  const fulfillment = platformCourier(input) ? 'delivery' : input.fulfillment;
  const phone = String(input.phone || '').trim();
  const note = String(input.note || '').trim();
  const minutes = input.minutes === undefined ? 30 : Number(input.minutes);
  const requestedAt = input.requestedAt || null;
  if (phone && (!/^[+\d\s()\-]{6,25}$/.test(phone) || phone.replace(/\D/g, '').length < 6)) fail('Zkontrolujte telefonní číslo.');
  if (note.length > 300) fail('Poznámka může mít nejvýše 300 znaků.');
  if (!integer(minutes, 10, 180) || minutes % 10) fail('Vyberte čas po 10 minutách v rozmezí 10 až 180 minut.');
  if (requestedAt && (!Number.isFinite(Date.parse(requestedAt)) || Date.parse(requestedAt) <= Date.parse(now) || Date.parse(requestedAt) > Date.parse(now) + 7 * 86400000)) fail('Vyberte budoucí čas nejvýše 7 dní dopředu.');
  if (!Array.isArray(input.lines) || !input.lines.length || input.lines.length > 100) fail('Přidejte pizzu do objednávky.');
  const menu = products(site);
  const lines = input.lines.map(line => {
    const item = menu.find(p => p.id === line.pizzaId);
    if (!item || (item.category === 'pizzy' && line.size !== 30) || !integer(line.quantity, 1, 20)) fail('Neplatná položka, velikost nebo počet.');
    const size = item.category === 'pizzy' ? line.size : null;
    return {pizzaId: item.id, name: pizzaName(item), size, quantity: line.quantity, unitPrice: size ? item.prices.find(p => p.diameter_cm === size).price_czk : item.price_czk};
  });
  const next = clone(state);
  const subtotal = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  const packaging = lines.reduce((sum, l) => sum + (l.size ? (l.size === 40 ? 23 : 16) * l.quantity : 0), 0);
  const delivery = fulfillment === 'delivery' ? site.delivery.price_czk : 0;
  const order = {id: `VISI-${++next.sequence}`, branchId: input.branchId, source: input.source,
    fulfillment, payment: input.payment, label: String(input.label || 'Demo objednávka').trim().slice(0, 80),
    status: 'new', lines, subtotal, packaging, delivery, total: subtotal + packaging + delivery,
    createdAt: now, updatedAt: now, minutes, phone, note, requestedAt, deduction: null,
    deliveryAddress: fulfillment === 'delivery' ? String(input.deliveryAddress || '').trim().slice(0, 180) : ''};
  next.orders.unshift(order);
  return {state: next, order};
}
export function requirements(state, order, seed, now = new Date().toISOString()) {
  const amounts = {};
  for (const line of order.lines) {
    if (line.size === null) continue; // Drinks are sold by piece; this stock module covers pizza ingredients.
    const recipe = state.recipes[line.pizzaId]?.[line.size];
    validateRecipe(recipe, seed);
    for (const [id, amount] of Object.entries(recipe)) amounts[id] = (amounts[id] || 0) + amount * line.quantity;
  }
  return Object.entries(amounts).map(([id, needed]) => {
    const ingredient = seed.ingredients.find(i => i.id === id);
    const summary = stockSummary(state, order.branchId, id, now);
    const available = summary.available;
    if (!integer(available, 0, 1000000000)) fail('Stav skladu je neplatný.');
    return {...ingredient, ...summary, needed, available, missing: Math.max(0, needed - available)};
  });
}
export function transitionOrder(state, id, target, seed, now = new Date().toISOString(), minutes = 30) {
  const original = state.orders.find(o => o.id === id);
  if (!original) fail('Objednávka neexistuje.');
  if (original.status === target) return state; // Repeated clicks/retries never debit twice.
  const allowed = {new: ['confirmed', 'preparing', 'cancelled'], confirmed: ['preparing', 'cancelled'], preparing: ['ready'], ready: ['completed']};
  if (!allowed[original.status]?.includes(target)) fail('Tento přechod objednávky už není možný. Obnovte přehled.');
  if (!integer(minutes, 5, 180)) fail('Čas přípravy musí být 5 až 180 minut.');
  const needs = target === 'preparing' && !original.deduction ? requirements(state, original, seed, now) : [];
  const missing = needs.filter(i => i.missing > 0);
  if (missing.length) fail(`Nedostatek surovin: ${missing.map(i => `${i.name} (chybí ${i.missing} ${i.unit})`).join(', ')}. Doplňte použitelné šarže a data spotřeby.`);
  const next = clone(state);
  const order = next.orders.find(o => o.id === id);
  if (target === 'completed' && order.fulfillment === 'delivery') {
    const provider = platformCourier(order);
    if (provider) order.handoff = {provider, at: now};
    else {
      const assignment = deliveryAssignment(next, order);
      if (!assignment) fail('Nejprve přiřaďte objednávku kurýrovi v plánu rozvozu.');
      order.handoff = {...assignment, at: now};
    }
  }
  if (target === 'preparing') {
    if (order.deduction) fail('Suroviny už byly odečteny.');
    order.deduction = {at: now, allocations: allocateBatches(next, order.branchId, needs, now), amounts: Object.fromEntries(needs.map(i => [i.id, i.needed]))};
    for (const ingredient of needs) next.stocks[order.branchId][ingredient.id] -= ingredient.needed;
    next.movements.unshift({id: `out-${id}`, type: 'out', at: now, branchId: order.branchId, orderId: id, note: 'Zahájení přípravy', amounts: clone(order.deduction.amounts), allocations: clone(order.deduction.allocations)});
  }
  order.status = target;
  order.minutes = minutes;
  order.updatedAt = now;
  if (['completed', 'cancelled'].includes(target)) removeDeliveryOrder(next, order);
  return next;
}
export function restock(state, seed, branchId, ingredientId, amount, metadata, now = new Date().toISOString()) {
  if (!Object.hasOwn(state.stocks, branchId) || !seed.ingredients.some(i => i.id === ingredientId)) fail('Vyberte platný sklad a surovinu.');
  if (!integer(amount, 1, 10000000) || state.stocks[branchId][ingredientId] + amount > 1000000000) fail('Zadejte kladné množství v celých g/ml (max. 10 000 kg/l).');
  const next = clone(state);
  const batch = addBatch(next, branchId, ingredientId, amount, metadata || {}, now);
  next.stocks[branchId][ingredientId] += amount;
  next.movements.unshift({id: `in-${next.revision}-${now}`, type: 'in', at: now, branchId, note: batch.note, batchId: batch.id, lot: batch.lot, receivedOn: batch.receivedOn, expiresOn: batch.expiresOn, amounts: {[ingredientId]: amount}});
  return next;
}
export function saveRecipe(state, site, seed, pizzaId, size, recipe) {
  if (!pizzas(site).some(p => p.id === pizzaId) || size !== 30) fail('Vyberte platnou pizzu a velikost.');
  validateRecipe(recipe, seed);
  const next = clone(state);
  next.recipes[pizzaId][size] = clone(recipe);
  return next;
}
export function createDemoState(site, seed) {
  let state = createState(site, seed);
  const menu = pizzas(site);
  for (const branch of site.branches) {
    const samples = [['web', 'new'], ['wolt', 'new'], ['foodora', 'new'], ['bolt', 'confirmed'], ['pos', 'confirmed'], ['wolt', 'preparing'], ['web', 'ready']];
    samples.forEach(([source, status], index) => {
      const now = new Date(Date.now() - (index + 1) * 180000).toISOString();
      const result = addOrder(state, site, {branchId: branch.id, source, fulfillment: index % 2 ? 'delivery' : 'pickup', payment: ['web', 'pos'].includes(source) ? 'cash' : 'online', label: `Demo ${String(index + 1).padStart(2, '0')}`, lines: [{pizzaId: menu[index].id, size: 30, quantity: index === 0 ? 2 : 1}]}, now);
      state = result.state;
      if (status !== 'new') state = transitionOrder(state, result.order.id, status === 'ready' ? 'preparing' : status, seed, now);
      if (status === 'ready') state = transitionOrder(state, result.order.id, 'ready', seed, now);
    });
  }
  return ensureDemoDeliveryOrders(state, site);
}
export function ensureDemoDeliveryOrders(state, site, now = new Date().toISOString()) {
  if (state.demoDeliverySamplesVersion === 1) return state;
  const samples = [
    ['Jan Novák', 'Ukázková 12', 0, 'web', 'confirmed'],
    ['Tereza Svobodová', 'Vzorová 8', 1, 'pos', 'new'],
    ['Martin Černý', 'Cvičná 5', 5, 'web', 'confirmed'],
    ['Petra Dvořáková', 'Modelová 24', 10, 'pos', 'confirmed'],
    ['Lucie Veselá', 'Ukázková 31', 3, 'web', 'new'],
    ['Tomáš Procházka', 'Vzorová 17', 14, 'pos', 'confirmed'],
  ];
  let next = state;
  const menu = pizzas(site);
  for (const branch of site.branches) for (const [index, [name, street, pizzaIndex, source, status]] of samples.entries()) {
    const createdAt = new Date(Date.parse(now) - (samples.length - index) * 120000).toISOString();
    const result = addOrder(next, site, {branchId: branch.id, source, fulfillment: 'delivery', payment: source === 'web' ? 'online' : 'cash', label: `${name} · demo`, deliveryAddress: `${street}, ${branch.name}`, lines: [{pizzaId: menu[pizzaIndex].id, size: 30, quantity: index % 3 === 0 ? 2 : 1}]}, createdAt);
    next = result.state;
    result.order.demoDeliverySample = true;
    result.order.status = status; // Pending demo orders do not consume existing inventory.
  }
  next.demoDeliverySamplesVersion = 1;
  next.revision = state.revision + 1;
  return next;
}
export function restoreState(raw, site, seed) {
  let state = JSON.parse(raw);
  if (state?.version === 1) state = migrateState(state, site, seed);
  if (state?.version !== 2 || !integer(state.revision, 0, Number.MAX_SAFE_INTEGER) || !integer(state.sequence, 1040, Number.MAX_SAFE_INTEGER) || !Array.isArray(state.orders) || !Array.isArray(state.movements)) fail('Uložená data administrace nejsou platná.');
  for (const branch of site.branches) for (const ingredient of seed.ingredients) if (!integer(state.stocks?.[branch.id]?.[ingredient.id], 0, 1000000000)) fail('Uložený sklad je neplatný.');
  for (const pizza of pizzas(site)) for (const size of [30]) validateRecipe(state.recipes?.[pizza.id]?.[size], seed);
  const ids = new Set();
  for (const order of state.orders) {
    if (typeof order.id !== 'string' || !/^VISI-\d+$/.test(order.id) || ids.has(order.id) || !Object.hasOwn(state.stocks, order.branchId) || !SOURCES.includes(order.source) || !STATUSES.includes(order.status) || !Array.isArray(order.lines) || !order.lines.length || !Number.isFinite(order.total) || order.total < 0) fail('Uložená objednávka je neplatná.');
    ids.add(order.id);
    for (const line of order.lines) {
      const item = products(site).find(p => p.id === line.pizzaId);
      if (!item || (item.category === 'pizzy' ? ![30, 40].includes(line.size) : line.size !== null) || !integer(line.quantity, 1, 20)) fail('Položka objednávky je neplatná.');
    }
    const deducted = ['preparing', 'ready', 'completed'].includes(order.status);
    if (order.handoff) {
      const validCourier = order.handoff.provider ? order.handoff.provider === platformCourier(order) && order.handoff.courierId === undefined && order.handoff.position === undefined : integer(order.handoff.courierId, 1, 3) && integer(order.handoff.position, 1, Number.MAX_SAFE_INTEGER);
      if (order.status !== 'completed' || order.fulfillment !== 'delivery' || !validCourier || !Number.isFinite(Date.parse(order.handoff.at))) fail('Záznam předání kurýrovi je neplatný.');
    }
    if (deducted !== Boolean(order.deduction)) fail('Záznam odečtu skladu je neplatný.');
    if (deducted && (!order.deduction.amounts || Object.entries(order.deduction.amounts).some(([id, qty]) => !seed.ingredients.some(i => i.id === id) || !integer(qty, 1, 1000000000)))) fail('Množství v odečtu je neplatné.');
  }
  for (const move of state.movements) {
    if (!Object.hasOwn(state.stocks, move.branchId) || !['in', 'out', 'waste', 'correction'].includes(move.type) || !move.amounts || Object.entries(move.amounts).some(([id, qty]) => !seed.ingredients.some(i => i.id === id) || !integer(qty, 1, 1000000000))) fail('Historie skladu je neplatná.');
  }
  validateBatches(state, seed, site);
  migrateCourierPolicy(state);
  validateDeliveryPlans(state);
  return state;
}

function migrateState(old, site, seed) {
  const next = clone(old);
  // Preserve recorded stock and historical deductions; unknown expiry stays unknown.
  next.version = 2; next.batchSequence = 0; next.batches = [];
  for (const branch of site.branches) for (const i of seed.ingredients) {
    const amount = next.stocks?.[branch.id]?.[i.id];
    if (!integer(amount, 0, 1000000000)) fail('Původní sklad je neplatný.');
    if (amount) next.batches.push({id: `LOT-${++next.batchSequence}`, branchId: branch.id, ingredientId: i.id, initial: amount, remaining: amount, lot: 'PŘEVEDENÁ ZÁSOBA', receivedOn: null, receivedAt: null, expiresOn: null, note: 'Doplňte údaje o příjmu a trvanlivosti.'});
  }
  for (const recipe of Object.values(next.recipes || {})) delete recipe[40];
  for (const order of next.orders || []) if (['new', 'confirmed'].includes(order.status)) {
    for (const line of order.lines) if (line.size === 40) {
      const pizza = pizzas(site).find(p => p.id === line.pizzaId);
      if (!pizza) fail('Původní objednávka je neplatná.');
      line.size = 30; line.unitPrice = pizza.prices.find(p => p.diameter_cm === 30).price_czk;
    }
    order.subtotal = order.lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
    order.packaging = order.lines.reduce((sum, l) => sum + (l.size ? 16 * l.quantity : 0), 0);
    order.total = order.subtotal + order.packaging + order.delivery;
  }
  return next;
}
export function saveRecipeCells(state, site, seed, changes) {
  const next = clone(state), affected = new Set();
  for (const change of changes) {
    if (!pizzas(site).some(p => p.id === change.pizzaId) || !seed.ingredients.some(i => i.id === change.ingredientId) || !integer(change.amount, 0, 10000)) fail('Množství musí být celé číslo od 0 do 10 000 g/ml.');
    const current = state.recipes[change.pizzaId][30][change.ingredientId] || 0;
    if (current !== change.before) fail('Stejnou buňku změnilo jiné okno. Zrušte své změny a načtěte aktuální hodnoty.');
    if (change.amount) next.recipes[change.pizzaId][30][change.ingredientId] = change.amount;
    else delete next.recipes[change.pizzaId][30][change.ingredientId];
    affected.add(change.pizzaId);
  }
  for (const id of affected) validateRecipe(next.recipes[id][30], seed);
  return next;
}
