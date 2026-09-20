import { normalizeSearch } from './menu-utils.js';

const words = value => normalizeSearch(value).replace(/[^a-z0-9]+/g, ' ').trim();

// Local demo only: locality names are matched against the published delivery areas.
// This does not validate streets, postal codes, distances or actual availability.
export function matchDeliveryBranch(address, branches) {
  const query = words(address);
  if (!query) return { status: 'empty', branchIds: [] };
  const branchIds = branches.filter(branch => {
    const localities = [branch.name, ...branch.delivery_areas].map(area =>
      words(area.replace(/\([^)]*\)/g, '').replace(/^Praha\s*[–-]\s*/i, ''))
    );
    return localities.some(locality => locality && ` ${query} `.includes(` ${locality} `));
  }).map(branch => branch.id);
  return { status: branchIds.length === 1 ? 'matched' : branchIds.length ? 'ambiguous' : 'unknown', branchIds };
}
