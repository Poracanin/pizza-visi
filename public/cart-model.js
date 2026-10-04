import { itemPrice } from './menu-utils.js';
import { normalizeCustomization, customizationFields, customizationDetails } from './pizza-customization.js?v=combined-removals-1';

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
  if (item.categoryId !== 'pizzy' && (input.base !== undefined || input.removedIngredients !== undefined)) return null;
  const customization = normalizeCustomization(item, input);
  if (!customization) return null;
  const size = item.prices.length ? (Number(input.size) === 40 ? 40 : 30) : null;
  const quantity = Math.min(MAX_QUANTITY, Math.max(1, Math.floor(Number(input.quantity) || 1)));
  const allowed = new Set(data.categories.filter(c => ADDON_CATEGORIES.includes(c.id)).flatMap(c => c.items.map(i => i.id)));
  const cleanExtras = (values, ids = allowed) => Array.isArray(values) ? [...new Set(values.filter(id => ids.has(id)))].sort() : [];
  let extras = item.categoryId === 'pizzy' ? cleanExtras(input.extras) : [];
  let halves;
  if (input.halves !== undefined) {
    // Never silently turn a broken half-and-half order into a different whole pizza.
    if (item.categoryId !== 'pizzy' || !Array.isArray(input.halves) || input.halves.length !== 2 || input.halves[0]?.itemId !== item.id || input.halves.some(half => getItem(data, half?.itemId)?.categoryId !== 'pizzy')) return null;
    const toppings = new Set(data.categories.find(c => c.id === 'dej-si-navic').items.map(i => i.id));
    if (input.base !== undefined || input.removedIngredients !== undefined) return null;
    halves = input.halves.map(half => {
      const choices = normalizeCustomization(getItem(data, half.itemId), half);
      return choices && { itemId: half.itemId, extras: cleanExtras(half.extras, toppings), ...choices };
    });
    if (halves.some(half => !half)) return null;
    extras = extras.filter(id => !toppings.has(id)); // Crust and sauces belong to the whole pizza.
  }
  return { itemId: item.id, size, quantity, extras, ...(halves ? { halves } : customization), note: typeof input.note === 'string' ? input.note.trim().slice(0, 180) : '' };
}
const customizationKey = part => Object.keys(customizationFields(part)).length ? [part.base || '', [...(part.removedIngredients || [])].sort()] : [];
export const lineKey = line => JSON.stringify([line.itemId, line.size, [...line.extras].sort(), line.note, ...customizationKey(line), ...(line.halves ? [line.halves.map(half => [half.itemId, [...half.extras].sort(), ...customizationKey(half)])] : [])]);
export const cloneLine = line => structuredClone(line);
export function mergeLine(cart, line, replaceIndex = -1) {
  const next = cart.filter((_, index) => index !== replaceIndex).map(cloneLine);
  const match = next.find(item => lineKey(item) === lineKey(line));
  if (match) match.quantity = Math.min(MAX_QUANTITY, match.quantity + line.quantity);
  else next.push(cloneLine(line));
  return next;
}
export function unitPrice(data, line) {
  const base = basePrice(data, line);
  const extras = [...line.extras, ...(line.halves || []).flatMap(half => half.extras)];
  // Each half's toppings cost the normal full amount, even when selected on both halves.
  return base + extras.reduce((sum, id) => sum + itemPrice(getItem(data, id), line.size), 0);
}
export function basePrice(data, line, size = line.size) {
  return Math.max(...(line.halves || [line]).map(part => itemPrice(getItem(data, part.itemId), size)));
}
const displayName = item => item.name.replace(/^\d+\.\s*/, '').replace(/\s*🌶️?/gu, '').trim();
export function lineName(data, line) {
  return line.halves ? line.halves.map(half => `½ ${displayName(getItem(data, half.itemId))}`).join(' + ') : displayName(getItem(data, line.itemId));
}
export function lineDetails(data, line) {
  const details = line.halves ? line.halves.map((half, index) => `${index + 1}. půlka · ${displayName(getItem(data, half.itemId))}: ${[...customizationDetails(half), ...(half.extras.length ? ['+ ' + half.extras.map(id => displayName(getItem(data, id))).join(', ')] : [])].join(' · ') || 'bez přísad navíc'}`) : customizationDetails(line);
  if (line.extras.length) details.push(`${line.halves ? 'K celé pizze: ' : '+ '}${line.extras.map(id => displayName(getItem(data, id))).join(', ')}`);
  return details;
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
