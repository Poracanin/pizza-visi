// Public projection of the RÚIAN snapshot. Canonical selected IDs, never typed
// labels, establish a valid delivery address in the local ordering flow.
const indexes = new WeakMap();
let pendingData;

function normalize(value) {
  return String(value ?? '').normalize('NFKD').toLowerCase()
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function indexFor(data) {
  if (!data || typeof data !== 'object') throw new Error('Adresář RÚIAN není dostupný.');
  if (indexes.has(data)) return indexes.get(data);
  if (data.version !== 1 || !Array.isArray(data.records) || data.count !== data.records.length
    || !/^\d{4}-\d{2}-\d{2}$/.test(data.source?.dataDate || '')) {
    throw new Error('Adresář RÚIAN nemá platný formát.');
  }
  const byId = new Map();
  const searchable = [];
  for (const row of data.records) {
    if (!Array.isArray(row) || row.length !== 4) throw new Error('Adresář RÚIAN obsahuje neplatnou adresu.');
    const [id, label, mask, postalCode] = row;
    if (typeof id !== 'string' || !/^[1-9]\d*$/.test(id) || byId.has(id)
      || typeof label !== 'string' || !label.trim() || ![1, 2, 3].includes(mask)
      || typeof postalCode !== 'string') throw new Error('Adresář RÚIAN obsahuje neplatnou adresu.');
    const branchIds = Object.freeze([...(mask & 1 ? ['rudna'] : []), ...(mask & 2 ? ['hostivice'] : [])]);
    const address = Object.freeze({ id, label, sourceDate: data.source.dataDate, branchIds });
    const labelText = normalize(label);
    const words = [...new Set(normalize(`${label} ${postalCode}`).split(' '))];
    byId.set(id, address);
    searchable.push({ address, words, labelText });
  }
  const index = { byId, searchable };
  indexes.set(data, index);
  return index;
}

export async function loadRuianAddresses() {
  if (!pendingData) {
    pendingData = (async () => {
      const response = await fetch(new URL('./data/ruian-addresses.json', import.meta.url));
      if (!response.ok) throw new Error('Adresář se nepodařilo načíst. Zkus to prosím znovu.');
      const data = await response.json();
      indexFor(data);
      return data;
    })().catch(error => { pendingData = null; throw error; });
  }
  return pendingData;
}

export function resolveAddress(data, id) {
  // A display label, numeric coercion, or object supplied by the form is not an ID.
  if (typeof id !== 'string' || !/^[1-9]\d*$/.test(id)) return null;
  return indexFor(data).byId.get(id) || null;
}

export function searchAddresses(data, query, limit = 8) {
  const normalized = normalize(String(query ?? '').slice(0, 160));
  if (normalized.length < 2) return [];
  const terms = [...new Set(normalized.split(' '))];
  if (terms.length > 12) return [];
  const take = Number.isFinite(Number(limit)) ? Math.max(0, Math.min(20, Math.floor(Number(limit)))) : 8;
  if (!take) return [];
  const matches = [];
  for (const entry of indexFor(data).searchable) {
    if (!terms.every(term => entry.words.some(word => word.startsWith(term)))) continue;
    // Exact street/house tokens rank before partial matches. Word order is free.
    const exact = terms.reduce((score, term) => score + (entry.words.includes(term) ? 1 : 0), 0);
    const prefix = entry.labelText.startsWith(normalized) ? 1 : 0;
    matches.push({ entry, score: exact * 2 + prefix });
  }
  matches.sort((a, b) => b.score - a.score || Number(a.entry.address.id) - Number(b.entry.address.id));
  return matches.slice(0, take).map(match => match.entry.address);
}
