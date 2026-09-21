import {createState, addOrder, pizzas, transitionOrder} from './admin/model.js?v=16388c99';
import {COURIERS, deliveryAssignment, deliveryPlan, saveDeliveryPlan, platformCourier} from './admin/delivery.js?v=bb45e9a7';

export const PREVIEW_KEY = 'pizza-visi-courier-preview-v1';
// Public places used only as sample destinations, never actual customer addresses.
const PREVIEW_STREETS = {
  rudna: ['Masarykova 94/53', 'Riegerova 527/50', '5. května 583'],
  hostivice: ['Husovo náměstí 13', 'Husovo náměstí 1702', 'Husovo náměstí 60'],
  beroun: ['Pivovarská 105/11', 'Pod Kaplankou 21', 'Pivovarská 105/11']
};
const LEGACY_PREVIEW_STREETS = ['Ukázková 12', 'Vzorová 8', 'Cvičná 5'];

export function upgradeCourierPreviewAddresses(state, site) {
  let next = state;
  for (const order of state.orders) {
    if (!order.courierPreview || order.courierMapSample) continue;
    const branch = site.branches.find(b => b.id === order.branchId);
    if (!branch || !PREVIEW_STREETS[branch.id]) continue;
    const index = LEGACY_PREVIEW_STREETS.findIndex(street => order.deliveryAddress === `${street}, ${branch.name}`);
    if (index < 0) continue; // Preserve any manually changed address.
    if (next === state) next = structuredClone(state);
    const updated = next.orders.find(o => o.id === order.id);
    updated.deliveryAddress = `${PREVIEW_STREETS[branch.id][index]}, ${branch.name}`;
    updated.courierMapSample = true;
  }
  return next;
}
const fail = message => { throw new Error(message); };
const ownDelivery = order => order.fulfillment === 'delivery' && !platformCourier(order);
const handed = order => ownDelivery(order) && order.status === 'completed' && COURIERS.includes(order.handoff?.courierId);
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
export const deliveryStatus = order => order.courierDelivery?.deliveredAt ? 'delivered' : order.courierDelivery?.issue ? 'issue' : handed(order) ? 'driving' : order.status === 'ready' ? 'ready' : 'waiting';
export const ISSUE_REASONS = ['Zákazník není k zastižení', 'Adresa se nedaří najít', 'Problém s platbou', 'Jiný problém s doručením'];

export function courierPaymentQuote(order, method, tip = 0) {
  if (!['cash', 'card', 'qr'].includes(method)) fail('Vyberte hotovost, kartu nebo QR platbu.');
  if (!Number.isSafeInteger(tip) || tip < 0 || tip > 10000) fail('Dýško zadejte v celých korunách od 0 do 10 000 Kč.');
  const base = order.payment === 'online' ? 0 : order.total;
  return {method, base, tip, amount: Math.round((base + tip) * 100) / 100};
}

export function collectDemoPayment(state, id, branchId, courierId, method, tip, now = new Date().toISOString()) {
  const order = assignedOrder(state, id, branchId, courierId);
  if (!handed(order) || order.courierDelivery?.deliveredAt) fail('Platbu lze potvrdit jen u probíhajícího rozvozu.');
  if (order.courierDelivery?.issue) fail('Nejdříve vyřešte problém s doručením.');
  const quote = courierPaymentQuote(order, method, tip);
  if (order.courierPayment) {
    if (order.courierPayment.method === method && order.courierPayment.tip === tip) return state;
    fail('Úhrada už je potvrzená. Další platbu nelze zadat.');
  }
  if (quote.amount <= 0) fail('Objednávka je zaplacená online. Zadejte pouze případné dýško.');
  if (!validTime(now) || Date.parse(now) < Date.parse(order.handoff.at)) fail('Čas platby není platný.');
  const next = structuredClone(state), target = next.orders.find(o => o.id === id);
  target.courierPayment = {...quote, demo: true, confirmedAt: now};
  target.updatedAt = now;
  return next;
}

export function courierPaymentTotals(orders) {
  const totals = {cash: 0, card: 0, qr: 0, online: 0, tips: 0};
  for (const order of orders) {
    const receipt = order.courierPayment;
    if (receipt) {
      totals[receipt.method] += receipt.amount;
      totals.tips += receipt.tip;
      if (order.payment === 'online') totals.online += order.total;
    } else if (order.courierDelivery?.deliveredAt) totals[order.payment] += order.total;
  }
  return totals;
}

export function courierOrders(state, branchId, courierId) {
  if (!COURIERS.includes(courierId)) return [];
  const assigned = deliveryPlan(state, branchId)[courierId - 1];
  const orders = state.orders.filter(order => order.branchId === branchId && ownDelivery(order));
  const driving = orders.filter(order => handed(order) && order.handoff.courierId === courierId && !order.courierDelivery?.deliveredAt)
    .sort((a, b) => a.handoff.at.localeCompare(b.handoff.at) || a.handoff.position - b.handoff.position || a.id.localeCompare(b.id));
  const pending = assigned.map(id => orders.find(order => order.id === id)).filter(order => order && ['new', 'confirmed', 'preparing', 'ready'].includes(order.status));
  return [...driving, ...pending];
}
export function courierHistory(state, branchId, courierId) {
  return state.orders.filter(order => order.branchId === branchId && handed(order) && order.handoff.courierId === courierId && order.courierDelivery?.deliveredAt)
    .sort((a, b) => b.courierDelivery.deliveredAt.localeCompare(a.courierDelivery.deliveredAt));
}
function assignedOrder(state, id, branchId, courierId) {
  const order = state.orders.find(o => o.id === id);
  if (!order || !ownDelivery(order) || order.branchId !== branchId || !COURIERS.includes(courierId)) fail('Objednávka není dostupná pro tento rozvoz.');
  const owner = handed(order) ? order.handoff.courierId : deliveryAssignment(state, order)?.courierId;
  if (owner !== courierId) fail('Přiřazení se změnilo. Objednávku má jiný kurýr.');
  return order;
}
export function takeOrder(state, id, branchId, courierId, seed, now = new Date().toISOString()) {
  const order = assignedOrder(state, id, branchId, courierId);
  if (handed(order)) return state;
  if (order.status !== 'ready') fail('Objednávka ještě není připravená k převzetí.');
  if (!order.deliveryAddress?.trim()) fail('Nejdříve doplňte doručovací adresu v administraci.');
  return transitionOrder(state, id, 'completed', seed, now, order.minutes);
}
export function finishDelivery(state, id, branchId, courierId, paymentConfirmed, now = new Date().toISOString()) {
  const order = assignedOrder(state, id, branchId, courierId);
  if (!handed(order)) fail('Nejdříve převezměte objednávku na pobočce.');
  if (order.courierDelivery?.deliveredAt) return state;
  if (order.courierDelivery?.issue) fail('Nejdříve vyřešte problém s doručením.');
  if (!['cash', 'card', 'online'].includes(order.payment)) fail('Způsob platby není platný.');
  if (order.payment !== 'online' && !order.courierPayment && paymentConfirmed !== true) fail('Potvrďte převzetí hotovosti nebo úhradu na terminálu.');
  if (!validTime(now) || Date.parse(now) < Date.parse(order.handoff.at)) fail('Čas doručení není platný.');
  if (order.courierPayment && Date.parse(now) < Date.parse(order.courierPayment.confirmedAt)) fail('Čas doručení nesmí předcházet platbě.');
  const next = structuredClone(state), target = next.orders.find(o => o.id === id);
  target.courierDelivery = {...target.courierDelivery, deliveredAt: now, payment: order.payment === 'online' ? 'online' : order.courierPayment?.method || order.payment, paymentConfirmedAt: order.courierPayment?.confirmedAt || now};
  target.updatedAt = now;
  return next;
}
export function setDeliveryIssue(state, id, branchId, courierId, issue, now = new Date().toISOString()) {
  const order = assignedOrder(state, id, branchId, courierId);
  if (!handed(order) || order.courierDelivery?.deliveredAt) fail('Problém lze označit jen u probíhajícího rozvozu.');
  if (issue !== null && !ISSUE_REASONS.includes(issue)) fail('Vyberte důvod problému.');
  if (!validTime(now) || Date.parse(now) < Date.parse(order.handoff.at)) fail('Čas záznamu není platný.');
  const next = structuredClone(state), target = next.orders.find(o => o.id === id);
  target.courierDelivery = {...target.courierDelivery, issue, issueAt: issue ? now : null};
  target.updatedAt = now;
  return next;
}
export function validateCourierState(state) {
  for (const order of state.orders) {
    const receipt = order.courierPayment;
    if (receipt !== undefined) {
      if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) || !handed(order) || receipt.demo !== true) fail('Uložená ukázková úhrada není platná.');
      const quote = courierPaymentQuote(order, receipt.method, receipt.tip);
      if (receipt.tip === undefined || receipt.base !== quote.base || receipt.amount !== quote.amount || receipt.amount <= 0 || !validTime(receipt.confirmedAt) || Date.parse(receipt.confirmedAt) < Date.parse(order.handoff.at)) fail('Uložená ukázková úhrada není platná.');
    }
    const record = order.courierDelivery;
    if (record === undefined) continue;
    if (!record || typeof record !== 'object' || Array.isArray(record) || !handed(order)) fail('Uložený záznam rozvozu není platný.');
    if (record.issue != null && (!ISSUE_REASONS.includes(record.issue) || !validTime(record.issueAt) || Date.parse(record.issueAt) < Date.parse(order.handoff.at))) fail('Uložený problém rozvozu není platný.');
    const payment = order.payment === 'online' ? 'online' : receipt?.method || order.payment;
    if (record.deliveredAt !== undefined && (!validTime(record.deliveredAt) || Date.parse(record.deliveredAt) < Date.parse(order.handoff.at) || record.issue || record.payment !== payment || !validTime(record.paymentConfirmedAt) || record.paymentConfirmedAt !== (receipt?.confirmedAt || record.deliveredAt) || Date.parse(record.paymentConfirmedAt) > Date.parse(record.deliveredAt))) fail('Uložené potvrzení doručení není platné.');
  }
  return state;
}

// A separate, explicitly labelled preview. Never seed or replace the POS storage.
export function createCourierPreview(site, seed, now = new Date().toISOString()) {
  let state = createState(site, seed, now);
  const menu = pizzas(site);
  const samples = [
    {label: 'Jan Novák', street: 'Ukázková 12', payment: 'cash', note: 'Zavolat při příjezdu. Zvonek Novák, 2. patro.'},
    {label: 'Tereza Svobodová', street: 'Vzorová 8', payment: 'online', note: 'Vchod ze dvora.'},
    {label: 'Martin Černý', street: 'Cvičná 5', payment: 'card', note: ''}
  ];
  for (const branch of site.branches) {
    const ids = [];
    for (let i = 0; i < samples.length; i++) {
      const {street, ...sample} = samples[i];
      const result = addOrder(state, site, {...sample, branchId: branch.id, source: i === 1 ? 'web' : 'pos', fulfillment: 'delivery', deliveryAddress: `${PREVIEW_STREETS[branch.id]?.[i] || street}, ${branch.name}`, lines: [{pizzaId: menu[i].id, size: 30, quantity: i === 0 ? 2 : 1}], minutes: 30}, now);
      state = result.state; ids.push(result.order.id);
      state = transitionOrder(state, result.order.id, 'preparing', seed, now);
      state = transitionOrder(state, result.order.id, 'ready', seed, now);
      state.orders.find(o => o.id === result.order.id).courierPreview = true;
      state.orders.find(o => o.id === result.order.id).courierMapSample = Boolean(PREVIEW_STREETS[branch.id]);
    }
    state = saveDeliveryPlan(state, branch.id, [ids, [], []], deliveryPlan(state, branch.id));
    // Show a route already on the road, with the final stop still at the branch.
    for (const id of ids.slice(0, 2)) state = takeOrder(state, id, branch.id, 1, seed, now);
  }
  return state;
}
