// A branch has at most three ordered courier queues. Planning never moves stock.
export const COURIERS = [1, 2, 3];
export const platformCourier = order => ['wolt', 'bolt', 'foodora'].includes(order.source) ? order.source : null;
const active = order => !platformCourier(order) && order.fulfillment === 'delivery' && ['new', 'confirmed', 'preparing', 'ready'].includes(order.status);
const fail = message => { throw new Error(message); };
export const deliveryOrders = (state, branchId) => state.orders.filter(order => order.branchId === branchId && active(order));
export const deliveryPlan = (state, branchId) => structuredClone(state.deliveryPlans?.[branchId] || [[], [], []]);
export function deliveryAssignment(state, order) {
  if (platformCourier(order)) return null;
  const plan = deliveryPlan(state, order.branchId);
  for (const courierId of COURIERS) {
    const index = plan[courierId - 1].indexOf(order.id);
    if (index !== -1) return {courierId, position: index + 1};
  }
  return null;
}
export function toggleDeliveryStop(plan, courierId, orderId) {
  if (!COURIERS.includes(courierId)) fail('Vyberte jednoho ze tří kurýrů.');
  const assigned = plan.findIndex(route => route.includes(orderId));
  if (assigned !== -1 && assigned !== courierId - 1) fail(`Objednávku již má kurýr ${assigned + 1}. Nejdřív ji odeberte z jeho trasy.`);
  const next = structuredClone(plan);
  if (assigned === courierId - 1) next[assigned] = next[assigned].filter(id => id !== orderId);
  else next[courierId - 1].push(orderId);
  return next;
}
export function migrateCourierPolicy(state) {
  if (state.courierPolicyVersion === 1) return;
  if (state.courierPolicyVersion !== undefined) fail('Pravidla rozvozu nejsou platná.');
  const platformIds = new Set(state.orders.filter(platformCourier).map(order => order.id));
  // Remove obsolete assignments only; keep quoted prices, stock and historical handoffs.
  if (state.deliveryPlans && typeof state.deliveryPlans === 'object' && !Array.isArray(state.deliveryPlans)) {
    for (const [branchId, plan] of Object.entries(state.deliveryPlans)) {
      if (Array.isArray(plan) && plan.length === 3 && plan.every(Array.isArray)) state.deliveryPlans[branchId] = plan.map(route => route.filter(id => !platformIds.has(id)));
    }
  }
  for (const order of state.orders) if (platformCourier(order) && !['completed', 'cancelled'].includes(order.status)) order.fulfillment = 'delivery';
  state.courierPolicyVersion = 1;
}
function validatePlan(state, branchId, plan) {
  if (!Object.hasOwn(state.stocks, branchId) || !Array.isArray(plan) || plan.length !== 3 || plan.some(route => !Array.isArray(route))) fail('Plán rozvozu musí obsahovat tři kurýry platné pobočky.');
  const available = new Set(deliveryOrders(state, branchId).map(order => order.id)), assigned = new Set();
  for (const route of plan) for (const id of route) {
    if (!available.has(id)) fail('Objednávka už není dostupná pro rozvoz této pobočky. Zavřete a znovu otevřete plán.');
    if (assigned.has(id)) fail('Objednávku lze přiřadit jen jednomu kurýrovi a jedné zastávce.');
    assigned.add(id);
  }
}
export function validateDeliveryPlans(state) {
  if (state.deliveryPlans === undefined) return; // Older demo data has no routes yet.
  if (!state.deliveryPlans || typeof state.deliveryPlans !== 'object' || Array.isArray(state.deliveryPlans)) fail('Uložený plán rozvozu není platný.');
  for (const [branchId, plan] of Object.entries(state.deliveryPlans)) validatePlan(state, branchId, plan);
}
export function saveDeliveryPlan(state, branchId, plan, before) {
  if (JSON.stringify(deliveryPlan(state, branchId)) !== JSON.stringify(before)) fail('Plán rozvozu změnilo jiné okno. Zavřete a znovu otevřete plán.');
  validatePlan(state, branchId, plan);
  const next = structuredClone(state);
  next.deliveryPlans ||= {};
  next.deliveryPlans[branchId] = structuredClone(plan);
  return next;
}
export function removeDeliveryOrder(state, order) {
  const plan = state.deliveryPlans?.[order.branchId];
  if (plan) state.deliveryPlans[order.branchId] = plan.map(route => route.filter(id => id !== order.id));
}
