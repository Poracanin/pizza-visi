// Dates are calendar dates in the restaurant's timezone. Quantities use g/ml.
const fail = message => { throw new Error(message); };
export function localDay(now = new Date().toISOString()) {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(new Date(now));
  return ['year', 'month', 'day'].map(key => parts.find(p => p.type === key).value).join('-');
}
export function validDay(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}
export const plusDays = (day, days) => new Date(Date.parse(`${day}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
export const daysLeft = (expiry, now) => Math.round((Date.parse(`${expiry}T12:00:00Z`) - Date.parse(`${localDay(now)}T12:00:00Z`)) / 86400000);
export function batchStatus(batch, now) {
  if (batch.remaining === 0) return 'empty';
  if (!batch.expiresOn) return 'undated';
  if (batch.expiresOn < localDay(now)) return 'expired';
  return daysLeft(batch.expiresOn, now) <= 3 ? 'soon' : 'ok';
}
export function stockSummary(state, branchId, ingredientId, now = new Date().toISOString()) {
  const batches = state.batches.filter(b => b.branchId === branchId && b.ingredientId === ingredientId);
  const remaining = batches.filter(b => b.remaining > 0);
  const expired = remaining.filter(b => batchStatus(b, now) === 'expired').reduce((s, b) => s + b.remaining, 0);
  const undated = remaining.filter(b => batchStatus(b, now) === 'undated').reduce((s, b) => s + b.remaining, 0);
  const total = remaining.reduce((s, b) => s + b.remaining, 0);
  const nearest = remaining.filter(b => b.expiresOn).sort((a, b) => a.expiresOn.localeCompare(b.expiresOn))[0];
  // A corrected batch date is authoritative; legacy receipts have no linked batch.
  const receivedDates = batches.map(b => b.receivedOn).filter(Boolean);
  const legacyDates = state.movements.filter(m => m.type === 'in' && !m.batchId && m.branchId === branchId && m.amounts[ingredientId]).map(m => m.receivedOn || localDay(m.at));
  const lastReceived = [...receivedDates, ...legacyDates].sort().at(-1) || null;
  return {total, available: total - expired - undated, expired, undated, nearest: nearest?.expiresOn || null, lastReceived, batchCount: remaining.length};
}
export function makeInitialBatches(state, seed, now) {
  const today = localDay(now);
  state.batchSequence = 0;
  state.batches = Object.entries(state.stocks).flatMap(([branchId, stocks]) => seed.ingredients.map(i => ({
    id: `LOT-${++state.batchSequence}`, branchId, ingredientId: i.id, lot: `DEMO-${i.id.slice(0, 8).toUpperCase()}`,
    receivedOn: today, receivedAt: now, expiresOn: plusDays(today, 14), initial: stocks[i.id], remaining: stocks[i.id], note: 'Ukázková počáteční zásoba',
  })));
}
export function addBatch(state, branchId, ingredientId, amount, meta, now) {
  const {receivedOn, expiresOn} = meta;
  if (!validDay(receivedOn) || receivedOn > localDay(now)) fail('Datum příjmu musí být platné a nesmí být v budoucnosti.');
  if (!validDay(expiresOn) || expiresOn < receivedOn) fail('Datum spotřeby musí být platné a nesmí předcházet příjmu.');
  const id = `LOT-${++state.batchSequence}`;
  const batch = {id, branchId, ingredientId, lot: String(meta.lot || id).trim().slice(0, 60) || id, receivedOn, receivedAt: now, expiresOn, initial: amount, remaining: amount, note: String(meta.note || '').slice(0, 100)};
  state.batches.push(batch);
  return batch;
}
export function allocateBatches(state, branchId, needs, now) {
  const allocations = [];
  for (const need of needs) {
    let left = need.needed;
    const batches = state.batches.filter(b => b.branchId === branchId && b.ingredientId === need.id && ['ok', 'soon'].includes(batchStatus(b, now)))
      .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn) || (a.receivedOn || '').localeCompare(b.receivedOn || '') || a.id.localeCompare(b.id));
    for (const batch of batches) {
      if (!left) break;
      const quantity = Math.min(batch.remaining, left);
      batch.remaining -= quantity; left -= quantity;
      allocations.push({batchId: batch.id, ingredientId: batch.ingredientId, lot: batch.lot, expiresOn: batch.expiresOn, quantity});
    }
    if (left) fail('Použitelné zásoby se změnily. Zkontrolujte šarže a trvanlivost.');
  }
  return allocations;
}
export function updateBatch(state, id, metadata, now = new Date().toISOString()) {
  const next = structuredClone(state), batch = next.batches.find(b => b.id === id);
  if (!batch || !batch.remaining) fail('Šarže už není na skladě.');
  if (!validDay(metadata.receivedOn) || metadata.receivedOn > localDay(now) || !validDay(metadata.expiresOn) || metadata.expiresOn < metadata.receivedOn) fail('Vyplňte platná data příjmu a spotřeby. Spotřeba nesmí předcházet příjmu.');
  const before = {lot: batch.lot, receivedOn: batch.receivedOn, expiresOn: batch.expiresOn};
  batch.lot = String(metadata.lot || batch.id).trim().slice(0, 60);
  batch.receivedOn = metadata.receivedOn; batch.expiresOn = metadata.expiresOn;
  next.movements.unshift({id: `edit-${id}-${state.revision}-${now}`, type: 'correction', branchId: batch.branchId, at: now, amounts: {}, batchId: id, before, after: {lot: batch.lot, receivedOn: batch.receivedOn, expiresOn: batch.expiresOn}, note: `Úprava šarže ${batch.lot}`});
  return next;
}
export function discardBatch(state, id, reason, now = new Date().toISOString()) {
  const next = structuredClone(state), batch = next.batches.find(b => b.id === id);
  if (!batch || !batch.remaining) fail('Šarže už není na skladě.');
  if (!String(reason).trim()) fail('Vyplňte důvod vyřazení.');
  const amount = batch.remaining;
  batch.remaining = 0; batch.discardedAt = now;
  next.stocks[batch.branchId][batch.ingredientId] -= amount;
  next.movements.unshift({id: `waste-${id}`, type: 'waste', at: now, branchId: batch.branchId, amounts: {[batch.ingredientId]: amount}, batchId: id, lot: batch.lot, note: String(reason).trim().slice(0, 100)});
  return next;
}
export function validateBatches(state, seed, site) {
  if (!Array.isArray(state.batches) || !Number.isSafeInteger(state.batchSequence) || state.batchSequence < 0) fail('Evidence šarží není platná.');
  const ids = new Set(), sums = {};
  for (const b of state.batches) {
    if (typeof b.id !== 'string' || !/^LOT-\d+$/.test(b.id) || ids.has(b.id) || !site.branches.some(v => v.id === b.branchId) || !seed.ingredients.some(i => i.id === b.ingredientId) || !Number.isSafeInteger(b.initial) || !Number.isSafeInteger(b.remaining) || b.initial < 0 || b.remaining < 0 || b.remaining > b.initial || (b.expiresOn !== null && !validDay(b.expiresOn)) || (b.receivedOn !== null && !validDay(b.receivedOn)) || (b.expiresOn && b.receivedOn && b.expiresOn < b.receivedOn)) fail('Uložená šarže není platná.');
    ids.add(b.id); const key = `${b.branchId}:${b.ingredientId}`; sums[key] = (sums[key] || 0) + b.remaining;
    if (Number(b.id.slice(4)) > state.batchSequence) fail('Pořadí šarží je neplatné.');
  }
  for (const branch of site.branches) for (const i of seed.ingredients) if ((sums[`${branch.id}:${i.id}`] || 0) !== state.stocks[branch.id][i.id]) fail('Součet šarží neodpovídá stavu skladu.');
}
