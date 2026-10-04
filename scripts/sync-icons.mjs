// Vendor sources and license: public/assets/icons/lucide/SOURCE.md.
// Embed the sprite in the document so icons work without fonts, CDN or cross-file SVG references.
import { readFile, writeFile } from 'node:fs/promises';
const icons = {cart:'shopping-cart',minus:'minus',plus:'plus',card:'credit-card',bag:'shopping-bag',truck:'truck',arrow:'arrow-right',back:'arrow-left',external:'arrow-up-right',pin:'map-pin',phone:'phone',clock:'clock',close:'x',chev:'chevron-down','chev-right':'chevron-right',pizza:'pizza',search:'search',leaf:'leaf',fire:'flame',check:'check',asterisk:'asterisk',diameter:'diameter',grid:'layout-grid',list:'list',cash:'banknote',play:'play',pause:'pause'};
const root = new URL('../public/', import.meta.url);
const symbols = await Promise.all(Object.entries(icons).map(async ([id, file]) => {
  const svg = await readFile(new URL(`assets/icons/lucide/${file}.svg`, root), 'utf8');
  const paths = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>[\s\S]*$/, '').trim();
  return `    <symbol id="i-${id}" viewBox="0 0 24 24">${paths}</symbol>`;
}));
const path = new URL('index.html', root);
const html = await readFile(path, 'utf8');
await writeFile(path, html.replace(/  <svg class="icon-library"[\s\S]*?<\/svg>/, `  <svg class="icon-library" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">\n${symbols.join('\n')}\n  </svg>`));
console.log(`Embedded ${symbols.length} local Lucide icons.`);
