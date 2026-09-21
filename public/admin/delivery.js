// A branch has at most three ordered courier queues. Planning never moves stock.
export const COURIERS = [1, 2, 3];
const active = order => order.fulfillment === 'delivery' && ['new', 'confirmed', 'preparing', 'ready'].includes(order.status);
const fail = message => { throw new Error(message); };
export const deliveryOrders = (state, branchId) => state.orders.filter(order => order.branchId === branchId && active(order));
export const deliveryPlan = (state, branchId) => structuredClone(state.deliveryPlans?.[branchId] || [[], [], []]);
export function deliveryAssignment(state, order) {
  const plan = deliveryPlan(state, order.branchId);
  for (const courierId of COURIERS) {
    const index = plan[courierId - 1].indexOf(order.id);
    if (index !== -1) return {courierId, position: index + 1};
  }
  return null;
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
