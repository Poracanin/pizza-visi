import { resolveAddress } from './ruian-addresses.js';

export const DELIVERY_PREFERENCE_KEY = 'pizza-visi-delivery-preference-v1';
export const STORAGE_CONSENT_KEY = 'pizza-visi-storage-consent-v1';
export const PREFERENCE_LIFETIME = 180 * 24 * 60 * 60 * 1000;

export function parseRememberedSelection(raw, now = Date.now()) {
  try {
    const value = JSON.parse(raw);
    if (value?.version !== 1 || !['delivery', 'pickup'].includes(value.fulfillment)
      || typeof value.branchId !== 'string' || !Number.isFinite(value.savedAt)
      || value.savedAt > now || now - value.savedAt > PREFERENCE_LIFETIME) return null;
    if (value.fulfillment === 'delivery' && (typeof value.addressId !== 'string' || !/^[1-9]\d*$/.test(value.addressId))) return null;
    return { fulfillment: value.fulfillment, branchId: value.branchId, addressId: value.fulfillment === 'delivery' ? value.addressId : null };
  } catch { return null; }
}

export function canonicalSelection(selection, data, addresses) {
  if (!selection || !['delivery', 'pickup'].includes(selection.fulfillment)
    || !data.branches.some(branch => branch.id === selection.branchId)) return null;
  if (selection.fulfillment === 'pickup') return { fulfillment: 'pickup', branchId: selection.branchId, addressId: null, address: '' };
  const address = addresses && resolveAddress(addresses, selection.addressId);
  if (!address || !address.branchIds.includes(selection.branchId)) return null;
  return { fulfillment: 'delivery', branchId: selection.branchId, addressId: address.id, address: address.label };
}

export function serializeRememberedSelection(selection, data, addresses, now = Date.now()) {
  const valid = canonicalSelection(selection, data, addresses);
  if (!valid) throw new Error('Vyber platnou adresu nebo pobočku.');
  // Persist only the canonical RÚIAN ID, not arbitrary address text or contact details.
  return JSON.stringify({ version: 1, fulfillment: valid.fulfillment, branchId: valid.branchId, addressId: valid.addressId, savedAt: now });
}

export function parseStorageConsent(raw) {
  try {
    const value = JSON.parse(raw);
    return value?.version === 1 && ['accepted', 'essential'].includes(value.mode) ? value.mode : null;
  } catch { return null; }
}
