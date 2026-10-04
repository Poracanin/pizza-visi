import { getItem, lineKey } from './cart-model.js?v=combined-removals-1';
export const PRODUCT_CATEGORIES = ['pizzy', 'napoje', 'vino-prosecco'];

export function productHash(itemId, size = 30) {
  return `#upravit/${encodeURIComponent(itemId)}?size=${Number(size) === 40 ? 40 : 30}`;
}

// null denotes an ordinary storefront anchor; invalid denotes a broken editor URL.
export function parseProductRoute(hash, data) {
  if (!/^#upravit(?:\/|\?|$)/.test(hash)) return null;
  const match = /^#upravit\/([^/?]+)(?:\?([^#]*))?$/.exec(hash);
  if (!match) return { invalid: true };
  let id;
  try { id = decodeURIComponent(match[1]); } catch { return { invalid: true }; }
  const item = getItem(data, id);
  if (!item || !PRODUCT_CATEGORIES.includes(item.categoryId)) return { invalid: true };
  return { itemId: id, size: new URLSearchParams(match[2]).get('size') === '40' ? 40 : 30 };
}

export const editSnapshot = line => line ? JSON.stringify([lineKey(line), line.quantity]) : null;

// A shifted array index is never enough to identify the line being edited.
export function findEditingLine(cart, snapshot) {
  if (!snapshot) return -1;
  const matches = cart.flatMap((line, index) => editSnapshot(line) === snapshot ? [index] : []);
  return matches.length === 1 ? matches[0] : -1;
}
