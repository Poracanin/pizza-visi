import { itemPrice } from './menu-utils.js';

export const MAX_QUANTITY = 20;
export const ADDON_CATEGORIES = ['dej-si-navic', 'chutne-okraje', 'omacky'];
export function getItem(data, id) {
  for (const category of data.categories) {
    const item = category.items.find(item => item.id === id);
    if (item) return { ...item, categoryId: category.id };
  }
  return null;
}
export function normalizeLine(data, input) {
  if (!input || typeof input !== 'object') return null;
  const item = getItem(data, input.itemId);
  if (!item || item.categoryId === 'baleni') return null;
  const size = item.prices.length ? (Number(input.size) === 40 ? 40 : 30) : null;
  const quantity = Math.min(MAX_QUANTITY, Math.max(1, Math.floor(Number(input.quantity) || 1)));
  const allowed = new Set(data.categories.filter(c => ADDON_CATEGORIES.includes(c.id)).flatMap(c => c.items.map(i => i.id)));
  const extras = item.categoryId === 'pizzy' && Array.isArray(input.extras) ? [...new Set(input.extras.filter(id => allowed.has(id)))].sort() : [];
  return { itemId: item.id, size, quantity, extras, note: typeof input.note === 'string' ? input.note.trim().slice(0, 180) : '' };
}
export const lineKey = line => JSON.stringify([line.itemId, line.size, [...line.extras].sort(), line.note]);
export function mergeLine(cart, line, replaceIndex = -1) {
  const next = cart.filter((_, index) => index !== replaceIndex).map(item => ({ ...item, extras: [...item.extras] }));
  const match = next.find(item => lineKey(item) === lineKey(line));
  if (match) match.quantity = Math.min(MAX_QUANTITY, match.quantity + line.quantity);
  else next.push({ ...line, extras: [...line.extras] });
  return next;
}
export function unitPrice(data, line) {
  return itemPrice(getItem(data, line.itemId), line.size) + line.extras.reduce((sum, id) => sum + itemPrice(getItem(data, id), line.size), 0);
}
export function cartTotals(data, cart, fulfillment = 'delivery') {
  const subtotal = cart.reduce((sum, line) => sum + unitPrice(data, line) * line.quantity, 0);
  const box = getItem(data, 'pizza-krabice');
  const packaging = cart.reduce((sum, line) => sum + (getItem(data, line.itemId).categoryId === 'pizzy' ? itemPrice(box, line.size) * line.quantity : 0), 0);
  const delivery = cart.length && fulfillment === 'delivery' ? data.delivery.price_czk : 0;
  return { subtotal, packaging, delivery, total: subtotal + packaging + delivery, quantity: cart.reduce((sum, line) => sum + line.quantity, 0) };
}
export function restoreCart(data, raw) {
  try {
    const saved = JSON.parse(raw);
    if (saved?.version !== 1 || !Array.isArray(saved.lines)) return [];
    return saved.lines.slice(0, 100).map(line => normalizeLine(data, { ...line, note: '' })).filter(Boolean).reduce((cart, line) => mergeLine(cart, line), []);
  } catch { return []; }
}
export function serializeCart(cart) {
  // Only menu choices persist. Contact details, addresses and notes stay in memory.
  return JSON.stringify({ version: 1, lines: cart.map(({ note, ...line }) => line) });
}
