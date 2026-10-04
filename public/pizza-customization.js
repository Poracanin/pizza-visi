export const PIZZA_BASES = { tomato: 'Rajčatový základ', cream: 'Smetanový základ' };
export const recipeBase = item => item.ingredients?.[0]?.toLocaleLowerCase('cs').includes('smetana') ? 'cream' : 'tomato';
const BASE_INGREDIENTS = { tomato: 'drcená rajčata', cream: 'smetana (halta)' };
export const removableIngredients = (item, part = {}) => (item.ingredients || []).map((ingredient, index) => index === 0 && part.base && part.base !== recipeBase(item) ? BASE_INGREDIENTS[part.base] : ingredient);

// Shared ingredients appear once, while each target retains its recipe's spelling.
export function removalChoices(line, lookupItem) {
  const choices = new Map();
  (line.halves || [line]).forEach((part, index) => {
    for (const ingredient of removableIngredients(lookupItem(part.itemId), part)) {
      const key = ingredient.toLocaleLowerCase('cs');
      if (!choices.has(key)) choices.set(key, { ingredient, targets: [], removed: 0 });
      const choice = choices.get(key);
      choice.targets.push({ index, ingredient });
      if (part.removedIngredients?.includes(ingredient)) choice.removed++;
    }
  });
  return [...choices.values()].map(choice => ({ ...choice, checked: choice.removed === choice.targets.length, mixed: choice.removed > 0 && choice.removed < choice.targets.length }));
}
export function setIngredientRemoval(line, lookupItem, ingredient, remove) {
  const choice = removalChoices(line, lookupItem).find(choice => choice.ingredient === ingredient);
  if (!choice) return false;
  const parts = line.halves || [line];
  for (const target of choice.targets) {
    const part = parts[target.index];
    const removed = new Set(part.removedIngredients || []);
    if (remove) removed.add(target.ingredient); else removed.delete(target.ingredient);
    if (removed.size) part.removedIngredients = [...removed].sort(); else delete part.removedIngredients;
  }
  return true;
}

// Keep unchanged recipes identical to old saved carts and order fingerprints.
export function normalizeCustomization(item, part) {
  if (part.base !== undefined && !Object.hasOwn(PIZZA_BASES, part.base)) return null;
  const allowed = removableIngredients(item, part);
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
