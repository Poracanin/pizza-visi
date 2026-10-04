import { STORAGE_KEY, createState, restoreState, orderId } from './admin/model.js?v=combined-removals-1';
import { getItem, normalizeLine, unitPrice, cartTotals, lineName } from './cart-model.js?v=combined-removals-1';
import { loadRuianAddresses, resolveAddress } from './ruian-addresses.js';
import { customizationFields, hasRecipeChanges } from './pizza-customization.js?v=combined-removals-1';

const reject = message => { throw new Error(message); };
let seedPromise;
const loadSeed = () => seedPromise ||= fetch(new URL('./admin/seed.json', import.meta.url)).then(response => {
  if (!response.ok) throw new Error('Administraci se nepodařilo načíst. Zkus to prosím znovu.');
  return response.json();
}).catch(error => { seedPromise = null; throw error; });

// The shared POS store is local to this browser. No payment or external dispatch occurs here.
export function createStorefrontOrder(state, input, addressCatalog, now = new Date().toISOString()) {
  const { data, cart, fulfillment, branchId, addressId, idempotencyKey } = input;
  const customer = input.customer || {};
  if (!data.branches.some(branch => branch.id === branchId)) reject('Vyber platnou pobočku.');
  if (!['delivery', 'pickup'].includes(fulfillment)) reject('Vyber doručení nebo vyzvednutí.');
  if (customer.payment !== 'cash') reject('Online platby zatím nejsou připojené. Vyber hotovost při převzetí.');
  if (!/^[a-zA-Z0-9_-]{12,100}$/.test(idempotencyKey || '')) reject('Objednávku se nepodařilo ověřit. Obnov stránku.');
  const name = String(customer.name || '').trim();
  const phone = String(customer.phone || '').trim();
  const email = String(customer.email || '').trim();
  const note = String(customer.note || '').trim();
  if (name.length < 2 || name.length > 70) reject('Doplň prosím jméno.');
  if (!/^\+?[\d\s()-]+$/.test(phone) || !/^\d{9,15}$/.test(phone.replace(/\D/g, ''))) reject('Zkontroluj telefonní číslo.');
  if (email && (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) reject('Zkontroluj e-mail.');
  if (note.length > 250) reject('Poznámka může mít nejvýše 250 znaků.');
  const address = fulfillment === 'delivery' ? resolveAddress(addressCatalog, addressId) : null;
  if (fulfillment === 'delivery' && !address) reject('Vyber doručovací adresu z nabídky RÚIAN.');
  if (address && !address.branchIds.includes(branchId)) reject('Tuto adresu z vybrané pobočky nerozvážíme.');
  if (address && customer.address !== address.label) reject('Adresa se změnila. Vyber ji z nabídky znovu.');
  if (!Array.isArray(cart) || !cart.length || cart.length > 100) reject('Košík je prázdný nebo obsahuje příliš mnoho položek.');
  const normalized = cart.map(line => {
    const item = getItem(data, line?.itemId);
    if (!item || !['pizzy', 'napoje', 'vino-prosecco'].includes(item.categoryId)) reject('Suroviny navíc přidávej přímo k vybrané pizze.');
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 20) reject('Zkontroluj počet kusů v košíku.');
    if (item.categoryId === 'pizzy' && ![30, 40].includes(line.size)) reject('Vyber velikost 30 nebo 40 cm.');
    const result = normalizeLine(data, line);
    if (!result) reject('Zkontroluj výběr pizzy, základu a odebraných surovin.');
    if ((line.extras || []).length !== result.extras.length || (line.extras || []).some(id => !result.extras.includes(id))) reject('Některá přísada už není v nabídce. Uprav pizzu znovu.');
    if (result.halves && line.halves.some((half, index) => !Array.isArray(half.extras) || half.extras.length !== result.halves[index].extras.length || half.extras.some(id => !result.halves[index].extras.includes(id)))) reject('Zkontroluj přísady pro jednotlivé půlky pizzy.');
    if (String(line.note || '').length > 180) reject('Poznámka k pizze je příliš dlouhá.');
    return result;
  });
  const fingerprint = JSON.stringify({ branchId, fulfillment, name, phone, email, note, addressId: address?.id || null, payment: 'cash', lines: normalized });
  const previous = state.orders.find(order => order.webRequest?.key === idempotencyKey);
  if (previous) {
    if (previous.webRequest.fingerprint !== fingerprint) reject('Tato objednávka už byla uložená s jinými údaji. Vytvoř novou objednávku.');
    return { state, order: previous, duplicate: true };
  }
  const total = cartTotals(data, normalized, fulfillment);
  const next = structuredClone(state);
  const lines = normalized.map(line => {
    return { pizzaId: line.itemId, name: lineName(data, line), size: line.size, quantity: line.quantity,
      unitPrice: unitPrice(data, line), extras: [...line.extras],
      ...(line.halves ? { halves: line.halves.map(half => ({ itemId: half.itemId, name: lineName(data, half), extras: [...half.extras], extraNames: half.extras.map(id => getItem(data, id).name), ...customizationFields(half) })) } : customizationFields(line)),
      extraNames: line.extras.map(id => getItem(data, id).name), note: line.note };
  });
  const order = {
    id: orderId(branchId, ++next.sequence), source: 'web', branchId, fulfillment, payment: 'cash',
    label: name, phone, email, note, deliveryAddress: address?.label || '',
    addressSnapshot: address ? structuredClone(address) : null,
    lines, subtotal: total.subtotal, packaging: total.packaging, delivery: total.delivery, total: total.total,
    status: 'new', createdAt: now, updatedAt: now, minutes: fulfillment === 'delivery' ? 50 : 20,
    requestedAt: null, deduction: null, configurationVersion: normalized.some(hasRecipeChanges) ? 3 : normalized.some(line => line.halves) ? 2 : 1,
    inventoryIncomplete: normalized.some(line => hasRecipeChanges(line) || line.size === 40 || line.extras.length > 0 || line.halves?.some(half => half.extras.length > 0)),
    webRequest: { key: idempotencyKey, fingerprint },
  };
  next.orders.unshift(order);
  next.revision = state.revision + 1;
  return { state: next, order, duplicate: false };
}

export async function submitLocalOrder(input, dependencies = {}) {
  const storage = dependencies.storage || globalThis.localStorage;
  const locks = dependencies.locks === undefined ? globalThis.navigator?.locks : dependencies.locks;
  const [seed, addresses] = await Promise.all([
    (dependencies.loadSeed || loadSeed)(),
    input.fulfillment === 'delivery' ? (dependencies.loadAddresses || loadRuianAddresses)() : Promise.resolve(null),
  ]);
  const save = () => {
    const raw = storage.getItem(STORAGE_KEY);
    const state = raw === null ? createState(input.data, seed) : restoreState(raw, input.data, seed);
    const result = createStorefrontOrder(state, input, addresses);
    if (!result.duplicate) storage.setItem(STORAGE_KEY, JSON.stringify(result.state));
    const saved = restoreState(storage.getItem(STORAGE_KEY), input.data, seed).orders.find(order => order.webRequest?.key === input.idempotencyKey);
    if (!saved || saved.id !== result.order.id) reject('Uložení objednávky se nepodařilo potvrdit. Košík zůstává zachovaný.');
    return { orderId: saved.id, total: saved.total, createdAt: saved.createdAt };
  };
  return locks?.request ? locks.request(STORAGE_KEY, save) : save();
}
