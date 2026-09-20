export function itemPrice(item, size = 30) {
  if (item.prices?.length) return item.prices.find(price => price.diameter_cm === size)?.price_czk ?? item.prices[0].price_czk;
  return item.price_czk;
}

export function normalizeSearch(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function matchesItem(item, query, filter = 'all') {
  const haystack = normalizeSearch(item.name + ' ' + item.description);
  if (query && !haystack.includes(normalizeSearch(query.trim()))) return false;
  if (filter === 'tomato') return normalizeSearch(item.description).includes('rajcata');
  if (filter === 'cream') return normalizeSearch(item.description).includes('smetana');
  if (filter === 'spicy') return item.name.includes('🌶');
  return true;
}

export function validBranch(branches, id) {
  return branches.find(branch => branch.id === id) ?? null;
}
