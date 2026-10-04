export const PIZZA_BASES = { tomato: 'Rajčatový základ', cream: 'Smetanový základ' };
export const recipeBase = item => item.ingredients?.[0]?.toLocaleLowerCase('cs').includes('smetana') ? 'cream' : 'tomato';
export const removableIngredients = item => (item.ingredients || []).slice(1);

// Keep unchanged recipes identical to old saved carts and order fingerprints.
export function normalizeCustomization(item, part) {
  if (part.base !== undefined && !Object.hasOwn(PIZZA_BASES, part.base)) return null;
  const allowed = removableIngredients(item);
  if (part.removedIngredients !== undefined && (!Array.isArray(part.removedIngredients) || part.removedIngredients.some(value => !allowed.includes(value)))) return null;
  const removed = [...new Set(part.removedIngredients || [])].sort();
  return {
    ...(part.base && part.base !== recipeBase(item) ? { base: part.base } : {}),
    ...(removed.length ? { removedIngredients: removed } : {}),
  };
}
export const customizationFields = part => ({
  ...(part.base ? { base: part.base } : {}),
  ...(part.removedIngredients?.length ? { removedIngredients: [...part.removedIngredients] } : {}),
});
export const hasRecipeChanges = line => (line.halves || [line]).some(part => part.base || part.removedIngredients?.length);
export const customizationDetails = part => [
  ...(part.base ? [PIZZA_BASES[part.base]] : []),
  ...(part.removedIngredients?.length ? [`Bez: ${part.removedIngredients.join(', ')}`] : []),
];
