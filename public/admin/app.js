import {STORAGE_KEY, SOURCES, pizzas, products, pizzaName, createDemoState, restoreState, addOrder, requirements, transitionOrder, restock, saveRecipe} from './model.js';
import {normalizeSearch, itemPrice} from '../menu-utils.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const money = value => `${new Intl.NumberFormat('cs-CZ').format(value)} Kč`;
const number = value => new Intl.NumberFormat('cs-CZ', {maximumFractionDigits: 3}).format(value);
const when = value => new Date(value).toLocaleString('cs-CZ', {day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit'});
const sourceNames = {web: 'Pizza Visi', pos: 'Pokladna', wolt: 'Wolt', foodora: 'foodora', bolt: 'Bolt Food'};
const statusNames = {new: 'Nové', confirmed: 'Potvrzené', preparing: 'V přípravě', ready: 'K výdeji', completed: 'Dokončené', cancelled: 'Zrušené'};
let site, seed, state, busy = false, branchId = 'rudna', view = 'orders', sourceFilter = 'all', search = '', lowOnly = false, toastTimer;
let draft = [], catalogSize = 30, catalogCategory = 'pizzy', recipeBase, editorOrder;
const dialog = $('#editor');
const branch = () => site.branches.find(b => b.id === branchId);
const branchOrders = () => state.orders.filter(o => o.branchId === branchId);
const ingredient = id => seed.ingredients.find(i => i.id === id);
const quantity = (value, unit) => value >= 1000 ? `${number(value / 1000)} ${unit === 'g' ? 'kg' : 'l'}` : `${number(value)} ${unit}`;
const sourceBadge = source => ['wolt', 'foodora', 'bolt'].includes(source)
  ? `<span class="source-badge source-${source}"><img src="./assets/logos/${source === 'wolt' ? 'wolt.png' : source === 'bolt' ? 'bolt-food.svg' : 'foodora.svg'}" alt="${sourceNames[source]}"></span>`
  : `<span class="source-badge source-${source}">${source === 'web' ? 'PIZZA <b>VISI</b>' : 'POS · Pokladna'}</span>`;
function notify(message, error = false) {
  clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').className = `visible ${error ? 'error' : ''}`;
  toastTimer = setTimeout(() => { $('#toast').className = ''; }, error ? 7000 : 3500);
}
function showError(error) {
  const box = $('#dialog-error');
  if (dialog.open && box) { box.textContent = error.message; box.hidden = false; box.scrollIntoView({block: 'nearest'}); }
  else notify(error.message, true);
}
const locked = fn => navigator.locks ? navigator.locks.request(STORAGE_KEY, fn) : fn();
async function transact(change, message) {
  if (busy) return false;
  busy = true;
  try {
    await locked(async () => {
      const current = restoreState(localStorage.getItem(STORAGE_KEY), site, seed);
      const next = change(current);
      if (next === current) { state = current; return; }
      next.revision = current.revision + 1;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); // A single atomic write includes stock, orders and ledger.
      state = next;
    });
    render(); notify(message); return true;
  } catch (error) { showError(error); return false; }
  finally { busy = false; }
}
function heading(eyebrow, title, description, action = '') {
  return `<header class="page-heading"><div><p class="eyebrow">${eyebrow}</p><div class="title-line"><h1>${title}</h1></div><p class="page-description">${description}</p></div>${action}</header>`;
}
function render() {
  $('#rail-count').textContent = branchOrders().filter(o => !['completed', 'cancelled'].includes(o.status)).length;
  $('#stock-alert').hidden = !seed.ingredients.some(i => state.stocks[branchId][i.id] <= i.minimum);
  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-current', b.dataset.view === view ? 'page' : 'false'));
  if (view === 'orders') renderOrders();
  if (view === 'stock') renderStock();
  if (view === 'recipes') renderRecipes();
  if (view === 'history') renderHistory();
}
function renderOrders() {
  const active = branchOrders().filter(o => !['completed', 'cancelled'].includes(o.status));
  const shown = active.filter(o => sourceFilter === 'all' || o.source === sourceFilter);
  $('#workspace').innerHTML = heading(`PROVOZ / ${esc(branch().name)}`, 'Objednávky', `<span class="live-dot"></span> ${active.length} aktivních objednávek · přehled kuchyně a výdeje`, '<button class="primary-button" data-new-order>＋ Nová objednávka</button>') +
    `<div class="channel-toolbar" role="group" aria-label="Filtrovat podle zdroje"><button data-source="all" aria-pressed="${sourceFilter === 'all'}">Všechny <b>${active.length}</b></button>${SOURCES.map(source => `<button data-source="${source}" aria-pressed="${sourceFilter === source}">${sourceBadge(source)}<b>${active.filter(o => o.source === source).length}</b></button>`).join('')}<span class="channels-note">Ukázkové kanály</span></div>
    <div class="orders-board">${['new', 'confirmed', 'preparing', 'ready'].map(status => `<section class="order-column" data-column="${status}" aria-label="${statusNames[status]}"><header class="column-header"><strong><i></i>${statusNames[status]}</strong><span>${shown.filter(o => o.status === status).length}</span></header><div class="column-list">${shown.filter(o => o.status === status).map(orderCard).join('') || '<p class="column-empty">Všechno vyřízeno.<br>Tady je zatím klid.</p>'}</div></section>`).join('')}</div>
    <footer class="orders-footer"><span><i class="status-dot"></i> Sklad se odečítá při zahájení přípravy</span><button class="text-button" data-go="history">Historie objednávek ↗</button></footer>`;
}
function orderCard(order) {
  const action = {new: 'Potvrdit objednávku', confirmed: 'Začít připravovat', preparing: 'Hotovo → k výdeji', ready: order.fulfillment === 'pickup' ? 'Předat zákazníkovi' : 'Předat kurýrovi'}[order.status];
  return `<article class="order-card is-${order.source}"><div class="card-top"><strong>#${esc(order.id.split('-')[1])}</strong>${sourceBadge(order.source)}</div><div class="card-time">${when(order.createdAt)} · ${esc(order.label)}</div><div class="order-items">${order.lines.map(l => `<div><b>${l.quantity}×</b><span><strong>${esc(l.name)}</strong><small>${l.size ? `${l.size} cm` : 'nápoj'}</small></span></div>`).join('')}</div><p class="fulfillment">${order.fulfillment === 'pickup' ? '↗ Vyzvednutí na pobočce' : '↗ Doručení kurýrem'}</p><div class="payment-line"><span>${{cash: 'Hotově', card: 'Karta · demo', online: 'Online · demo'}[order.payment]}</span><strong>${money(order.total)}</strong></div>${order.deduction ? '<p class="deducted">✓ Suroviny odečteny</p>' : ''}<button class="advance-order" data-order="${esc(order.id)}">${action}</button></article>`;
}
function stockStats() {
  return `<div class="stat-grid"><article><span>Suroviny ve skladu</span><strong>${seed.ingredients.length}<small> položek</small></strong></article><article><span>Pod minimální zásobou</span><strong class="${seed.ingredients.some(i => state.stocks[branchId][i.id] <= i.minimum) ? 'danger-text' : 'green-text'}">${seed.ingredients.filter(i => state.stocks[branchId][i.id] <= i.minimum).length}<small> k doplnění</small></strong></article><article><span>Receptury propojené se skladem</span><strong>${pizzas(site).length}<small> pizz · 2 velikosti</small></strong></article></div>`;
}
function renderStock() {
  $('#workspace').innerHTML = heading(`ZÁSOBY / ${esc(branch().name)}`, 'Sklad', 'Suroviny pro všechny pizzy. Každá pobočka má vlastní zásoby a pohyby.', '<button class="primary-button" data-restock="">＋ Naskladnit</button>') + stockStats() +
  `<div class="panel stock-panel"><div class="panel-toolbar"><label class="search-field"><span>⌕</span><input id="stock-search" type="search" placeholder="Najít surovinu…" aria-label="Hledat surovinu" value="${esc(search)}"></label><label class="check-label"><input type="checkbox" id="low-only" ${lowOnly ? 'checked' : ''}> Jen k doplnění</label><span class="muted">Základní jednotky g / ml</span></div><div class="table-scroll"><table><thead><tr><th>Surovina</th><th>Na skladě</th><th>Minimum</th><th>V recepturách</th><th>Stav</th><th><span class="sr-only">Akce</span></th></tr></thead><tbody id="stock-rows"></tbody></table></div></div><div class="section-title"><h2>Poslední pohyby</h2><span>Posledních 20 záznamů · ${esc(branch().name)}</span></div><div class="movement-list">${movementRows()}</div>`;
  renderStockRows();
}
function renderStockRows() {
  const rows = seed.ingredients.filter(i => normalizeSearch(i.name).includes(normalizeSearch(search)) && (!lowOnly || state.stocks[branchId][i.id] <= i.minimum));
  $('#stock-rows').innerHTML = rows.map(i => {
    const amount = state.stocks[branchId][i.id], low = amount <= i.minimum;
    const count = pizzas(site).filter(p => [30, 40].some(size => state.recipes[p.id][size][i.id])).length;
    return `<tr><td><strong>${esc(i.name)}</strong><small>${i.unit === 'g' ? 'Hmotnost · g' : 'Objem · ml'}</small></td><td class="stock-amount">${quantity(amount, i.unit)}</td><td class="muted">${quantity(i.minimum, i.unit)}</td><td>${count} pizz</td><td><span class="stock-status ${low ? 'low' : ''}">${low ? '● Doplnit' : '● Dostatek'}</span></td><td><button class="small-button" data-restock="${i.id}" aria-label="Naskladnit ${esc(i.name)}">＋ Naskladnit</button></td></tr>`;
  }).join('') || '<tr><td colspan="6" class="empty-state">Žádná surovina neodpovídá filtru.</td></tr>';
}
function movementRows() {
  return state.movements.filter(m => m.branchId === branchId).slice(0, 20).map(m => `<article class="movement"><span class="movement-icon ${m.type}">${m.type === 'in' ? '↙' : '↗'}</span><div><strong>${m.type === 'in' ? 'Naskladnění' : `Příprava #${esc(m.orderId?.split('-')[1])}`}</strong><p>${Object.entries(m.amounts).map(([id, amount]) => `${esc(ingredient(id).name)} ${m.type === 'in' ? '+' : '−'}${quantity(amount, ingredient(id).unit)}`).join(' · ') || 'Bez skladových surovin'}</p>${m.note ? `<small>${esc(m.note)}</small>` : ''}</div><time>${when(m.at)}</time></article>`).join('') || '<p class="empty-state">Zatím žádný pohyb ve skladu.</p>';
}
function renderRecipes() {
  $('#workspace').innerHTML = heading('NORMY / VŠECHNY POBOČKY', 'Receptury pizz', 'Nastavte přesné množství surovin na jednu pizzu o průměru 30 a 40 cm.') + `<div class="recipe-notice"><strong>Ukázkové gramáže</strong><span>Nejde o ověřené normy pizzerie. Upravte je podle kuchyně. Těsto evidujeme jako hotový polotovar.</span></div><div class="recipe-grid">${pizzas(site).map(p => `<article class="recipe-card"><img src="../${esc(p.image)}" alt="${esc(pizzaName(p))}" loading="lazy"><div><span class="eyebrow">RECEPTURA ${String(p.number).padStart(2, '0')}</span><h2>${esc(pizzaName(p))}</h2><p>${Object.keys(state.recipes[p.id][30]).map(id => ingredient(id).name).join(', ')}</p><footer><span>30 cm / 40 cm</span><button class="small-button" data-recipe="${p.id}">Upravit recepturu ↗</button></footer></div></article>`).join('')}</div>`;
}
function renderHistory() {
  const orders = branchOrders().filter(o => ['completed', 'cancelled'].includes(o.status));
  $('#workspace').innerHTML = heading(`ARCHIV / ${esc(branch().name)}`, 'Historie objednávek', 'Dokončené a zrušené demo objednávky. Odečty zůstávají v historii skladu.') + `<div class="panel table-scroll"><table><thead><tr><th>Objednávka</th><th>Zdroj</th><th>Položky</th><th>Stav</th><th>Celkem</th><th>Čas</th></tr></thead><tbody>${orders.map(o => `<tr><td><strong>#${esc(o.id.split('-')[1])}</strong><small>${esc(o.label)}</small></td><td>${sourceBadge(o.source)}</td><td>${o.lines.map(l => `${l.quantity}× ${esc(l.name)}${l.size ? ` ${l.size} cm` : ''}`).join('<br>')}</td><td>${statusNames[o.status]}</td><td>${money(o.total)}</td><td>${when(o.updatedAt)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty-state">První dokončené objednávky se objeví tady.</td></tr>'}</tbody></table></div>`;
}
function openDialog(title, subtitle, content, className = '') {
  dialog.className = className;
  $('#dialog-content').innerHTML = `<header class="dialog-header"><div><p class="eyebrow">PIZZA VISI / ${esc(branch().name)}</p><h2 id="dialog-title">${title}</h2><p>${subtitle}</p></div><button type="button" class="close-button" data-close aria-label="Zavřít okno">×</button></header><p id="dialog-error" role="alert" class="error-box" hidden></p>${content}`;
  if (!dialog.open) dialog.showModal();
}
function openRestock(id) {
  const chosen = ingredient(id) || seed.ingredients[0];
  openDialog('Naskladnit suroviny', `Příjem do skladu pobočky ${esc(branch().name)}.`, `<form id="restock-form" class="dialog-form"><label>Surovina<select id="stock-ingredient" name="ingredient">${seed.ingredients.map(i => `<option value="${i.id}" ${chosen.id === i.id ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}</select></label><div class="form-columns"><label>Množství<input name="amount" type="number" min="0.001" step="0.001" max="10000000" placeholder="Např. 5" required autofocus></label><label>Jednotka<select name="unit" id="stock-unit"></select></label></div><p id="restock-preview" class="inline-note"></p><label>Poznámka <span class="muted">nepovinné</span><input name="note" maxlength="100" placeholder="Např. ranní dodávka"></label><footer class="dialog-footer"><button type="button" class="secondary-button" data-close>Zrušit</button><button class="primary-button" type="submit">Potvrdit naskladnění</button></footer></form>`);
  stockUnits();
}
function stockUnits() {
  const i = ingredient($('#stock-ingredient').value);
  $('#stock-unit').innerHTML = `<option value="1000">${i.unit === 'g' ? 'kg' : 'l'}</option><option value="1">${i.unit}</option>`;
  stockPreview();
}
function stockPreview() {
  const form = $('#restock-form'), i = ingredient(form.elements.ingredient.value);
  const addition = Number(form.elements.amount.value) * Number(form.elements.unit.value);
  $('#restock-preview').textContent = `Nyní ${quantity(state.stocks[branchId][i.id], i.unit)} → po naskladnění ${quantity(state.stocks[branchId][i.id] + (Number.isFinite(addition) ? addition : 0), i.unit)}`;
}
function openRecipe(id) {
  const p = pizzas(site).find(p => p.id === id);
  recipeBase = JSON.stringify(state.recipes[id]);
  openDialog(`Receptura · ${esc(pizzaName(p))}`, 'Množství na 1 pizzu. Hodnota 0 surovinu z receptury vyřadí.', `<form id="recipe-form" data-pizza="${id}"><div class="inline-note recipe-note">Společné pro všechny pobočky. Změny se použijí u objednávek, které ještě nezačaly přípravu. Dřívější odečty se nepřepočítají.</div><div class="table-scroll recipe-table"><table><thead><tr><th>Surovina</th><th>30 cm</th><th>40 cm</th><th>Jednotka</th></tr></thead><tbody>${seed.ingredients.map(i => `<tr><td>${esc(i.name)}</td>${[30, 40].map(size => `<td><input type="number" name="${i.id}:${size}" min="0" max="10000" step="1" required value="${state.recipes[id][size][i.id] || 0}" aria-label="${esc(i.name)} ${size} cm (${i.unit})"></td>`).join('')}<td class="muted">${i.unit}</td></tr>`).join('')}</tbody></table></div><footer class="dialog-footer"><button class="secondary-button" type="button" data-close>Zrušit</button><button class="primary-button" type="submit">Uložit recepturu</button></footer></form>`, 'recipe-dialog');
}
function openOrder(id) {
  const order = state.orders.find(o => o.id === id);
  if (!order || ['completed', 'cancelled'].includes(order.status)) return;
  editorOrder = id;
  let needs;
  try { needs = order.deduction ? Object.entries(order.deduction.amounts).map(([id, needed]) => ({...ingredient(id), needed})) : requirements(state, order, seed); }
  catch (error) { return notify(error.message, true); }
  const shortage = needs.some(i => i.missing > 0);
  const stockCaption = order.deduction ? 'Odečtené suroviny · záznam při zahájení' : 'Odečte se při zahájení přípravy';
  let buttons = '';
  if (order.status === 'new') buttons = `<button class="secondary-button" data-transition="confirmed">Jen potvrdit</button><button class="primary-button" data-transition="preparing">Potvrdit a připravovat</button>`;
  if (order.status === 'confirmed') buttons = '<button class="primary-button" data-transition="preparing">Začít přípravu a odečíst sklad</button>';
  if (order.status === 'preparing') buttons = '<button class="primary-button" data-transition="ready">Hotovo → k výdeji</button>';
  if (order.status === 'ready') buttons = `<button class="primary-button" data-transition="completed">${order.fulfillment === 'pickup' ? 'Předat zákazníkovi' : 'Předat kurýrovi'}</button>`;
  openDialog(`Objednávka #${esc(id.split('-')[1])}`, `${esc(order.label)} · ${statusNames[order.status]} · ${when(order.createdAt)}`, `<div class="order-detail"><div class="detail-source">${sourceBadge(order.source)}<strong>${money(order.total)}</strong></div><div class="detail-items">${order.lines.map(l => `<div><span>${l.quantity}× ${esc(l.name)} ${l.size ? `· ${l.size} cm` : ''}</span><strong>${money(l.quantity * l.unitPrice)}</strong></div>`).join('')}<div class="muted"><span>Krabice / rozvoz</span><span>${money(order.packaging)} / ${money(order.delivery)}</span></div></div><h3>${stockCaption}</h3>${shortage ? '<p class="stock-warning">Některé suroviny chybí. Objednávku lze potvrdit, příprava začne až po naskladnění.</p>' : ''}<div class="deduction-list">${needs.map(i => `<div class="${i.missing ? 'is-missing' : ''}"><span>${esc(i.name)}</span><strong>−${quantity(i.needed, i.unit)}</strong>${i.missing ? `<small>Chybí ${quantity(i.missing, i.unit)}</small>` : ''}</div>`).join('') || '<p class="muted">Nápoje neodečítají suroviny pro pizzu.</p>'}</div>${['new', 'confirmed'].includes(order.status) ? `<label class="eta-field">Připravit za <input id="order-minutes" type="number" min="5" max="180" step="5" value="${order.minutes}"> minut</label>` : '<p class="inline-note">Sklad už byl odečten. Posun objednávky jej znovu nezmění.</p>'}</div><footer class="dialog-footer">${['new', 'confirmed'].includes(order.status) ? '<button class="text-button danger-text" data-cancel-order>Zrušit objednávku</button>' : ''}<div class="footer-actions">${buttons}</div></footer>`, 'order-dialog');
}
function openNewOrder() {
  draft = []; catalogSize = 30; catalogCategory = 'pizzy';
  openDialog('Nová objednávka', 'Ukázkový prodej na pobočce nebo z libovolného kanálu.', `<form id="new-order-form"><div class="new-order-layout"><section class="catalog-pane" aria-label="Nabídka"><div class="catalog-tools"><select id="catalog-category" aria-label="Kategorie"><option value="pizzy">Pizzy · 24</option><option value="napoje">Nápoje</option><option value="vino-prosecco">Víno a prosecco</option></select><div class="size-options" role="group" aria-label="Velikost pizzy"><button type="button" data-size="30" aria-pressed="true">30 cm</button><button type="button" data-size="40" aria-pressed="false">40 cm</button></div></div><div id="product-grid" class="product-grid"></div></section><aside class="cart-pane"><h3>Košík</h3><div id="cart-lines"></div><div class="form-columns"><label>Zdroj<select name="source">${SOURCES.map(s => `<option value="${s}" ${s === 'pos' ? 'selected' : ''}>${sourceNames[s]}</option>`).join('')}</select></label><label>Předání<select name="fulfillment" id="fulfillment"><option value="pickup">Vyzvednutí</option><option value="delivery">Doručení</option></select></label></div><label>Označení <span class="muted">jen ukázkové údaje</span><input name="label" value="Demo objednávka" maxlength="80" required></label><label>Platba<select name="payment"><option value="cash">Hotově</option><option value="card">Kartou · demo</option><option value="online">Online · demo</option></select></label><div id="draft-total"></div><p class="inline-note">Suroviny se odečtou až při zahájení přípravy. Platby a doručení jsou simulované.</p><button class="primary-button" id="create-order" type="submit" disabled>Vytvořit objednávku</button></aside></div></form>`, 'new-order-dialog');
  renderCatalog(); renderDraft();
}
function renderCatalog() {
  $('#product-grid').innerHTML = products(site).filter(p => p.category === catalogCategory).map(p => `<button type="button" class="product-card" data-add="${p.id}" aria-label="Přidat ${esc(pizzaName(p))}${p.category === 'pizzy' ? ` ${catalogSize} cm` : ''}">${p.image ? `<img src="../${esc(p.image)}" alt="" loading="lazy">` : '<span class="drink-placeholder">◒</span>'}<strong>${esc(pizzaName(p))}</strong><span>${money(itemPrice(p, catalogSize))}<b>＋</b></span></button>`).join('');
  document.querySelectorAll('[data-size]').forEach(b => b.setAttribute('aria-pressed', Number(b.dataset.size) === catalogSize));
}
function renderDraft() {
  $('#cart-lines').innerHTML = draft.map((l, index) => {const p = products(site).find(p => p.id === l.pizzaId); return `<div class="cart-line"><div><strong>${esc(pizzaName(p))}</strong><small>${l.size ? `${l.size} cm` : 'nápoj'} · ${money(itemPrice(p, l.size))}</small></div><div class="quantity-control"><button type="button" data-quantity="${index}" data-delta="-1" aria-label="Ubrat ${esc(pizzaName(p))}">−</button><span>${l.quantity}</span><button type="button" data-quantity="${index}" data-delta="1" aria-label="Přidat kus ${esc(pizzaName(p))}" ${l.quantity >= 20 ? 'disabled' : ''}>＋</button></div></div>`;}).join('') || '<p class="empty-state">Vyberte něco dobrého.<br>Klepnutím přidáte položku.</p>';
  const subtotal = draft.reduce((sum, l) => sum + itemPrice(products(site).find(p => p.id === l.pizzaId), l.size) * l.quantity, 0);
  const packaging = draft.reduce((sum, l) => sum + (l.size ? (l.size === 40 ? 23 : 16) * l.quantity : 0), 0);
  const delivery = draft.length && $('#fulfillment').value === 'delivery' ? site.delivery.price_czk : 0;
  $('#draft-total').innerHTML = `<div><span>Krabice / rozvoz</span><span>${money(packaging)} / ${money(delivery)}</span></div><div><strong>Celkem</strong><strong>${money(subtotal + packaging + delivery)}</strong></div>`;
  $('#create-order').disabled = !draft.length;
}
function setView(next) { if (!['orders', 'stock', 'recipes', 'history'].includes(next)) return; view = next; history.replaceState(null, '', `#${next}`); render(); window.scrollTo({top: 0, behavior: 'instant'}); }

document.addEventListener('click', async event => {
  const button = event.target.closest('button'); if (!button || busy || !state) return;
  if (button.hasAttribute('data-view')) return setView(button.dataset.view);
  if (button.hasAttribute('data-go')) return setView(button.dataset.go);
  if (button.hasAttribute('data-source')) { sourceFilter = button.dataset.source; return renderOrders(); }
  if (button.hasAttribute('data-close')) return dialog.close();
  if (button.hasAttribute('data-restock')) return openRestock(button.dataset.restock);
  if (button.hasAttribute('data-recipe')) return openRecipe(button.dataset.recipe);
  if (button.hasAttribute('data-order')) return openOrder(button.dataset.order);
  if (button.hasAttribute('data-new-order')) return openNewOrder();
  if (button.hasAttribute('data-size')) { catalogSize = Number(button.dataset.size); return renderCatalog(); }
  if (button.hasAttribute('data-add')) {
    const product = products(site).find(p => p.id === button.dataset.add), size = product.category === 'pizzy' ? catalogSize : null;
    const line = draft.find(l => l.pizzaId === product.id && l.size === size);
    if (line && line.quantity >= 20) return notify('Nejvýše 20 kusů jedné položky.', true);
    if (line) line.quantity++; else draft.push({pizzaId: product.id, size, quantity: 1});
    return renderDraft();
  }
  if (button.hasAttribute('data-quantity')) { const index = Number(button.dataset.quantity); draft[index].quantity += Number(button.dataset.delta); draft = draft.filter(l => l.quantity > 0); return renderDraft(); }
  if (button.hasAttribute('data-cancel-order')) {
    button.outerHTML = '<button class="text-button danger-text" data-transition="cancelled">Opravdu zrušit objednávku?</button>'; return;
  }
  if (button.hasAttribute('data-transition')) {
    const minutes = $('#order-minutes') ? Number($('#order-minutes').value) : state.orders.find(o => o.id === editorOrder).minutes;
    const next = button.dataset.transition;
    if (await transact(current => transitionOrder(current, editorOrder, next, seed, undefined, minutes), next === 'preparing' ? 'Příprava zahájena. Suroviny byly odečteny.' : `Objednávka: ${statusNames[next].toLowerCase()}.`)) dialog.close();
  }
});
document.addEventListener('change', event => {
  if (event.target.id === 'branch') { branchId = event.target.value; sessionStorage.setItem('pizza-visi-admin-branch', branchId); sourceFilter = 'all'; render(); }
  if (event.target.id === 'low-only') { lowOnly = event.target.checked; renderStockRows(); }
  if (event.target.id === 'stock-ingredient') stockUnits();
  if (event.target.id === 'stock-unit') stockPreview();
  if (event.target.id === 'catalog-category') { catalogCategory = event.target.value; renderCatalog(); }
  if (event.target.id === 'fulfillment') renderDraft();
});
document.addEventListener('input', event => {
  if (event.target.id === 'stock-search') { search = event.target.value; renderStockRows(); }
  if (event.target.closest('#restock-form') && event.target.name === 'amount') stockPreview();
});
document.addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  const form = event.target, data = new FormData(form);
  if (form.id === 'restock-form') {
    const rawAmount = Number(data.get('amount')) * Number(data.get('unit'));
    const amount = Math.round(rawAmount);
    if (Math.abs(rawAmount - amount) > 0.000001) return showError(new Error('Nejmenší jednotka je 1 g nebo 1 ml.'));
    if (await transact(current => restock(current, seed, branchId, data.get('ingredient'), amount, data.get('note')), 'Surovina byla naskladněna.')) dialog.close();
  }
  if (form.id === 'recipe-form') {
    const id = form.dataset.pizza;
    const recipes = Object.fromEntries([30, 40].map(size => [size, Object.fromEntries(seed.ingredients.map(i => [i.id, Number(data.get(`${i.id}:${size}`))]).filter(([, amount]) => amount !== 0))]));
    if (await transact(current => {
      if (JSON.stringify(current.recipes[id]) !== recipeBase) throw new Error('Receptura se změnila v jiném okně. Zavřete ji a otevřete znovu.');
      return saveRecipe(saveRecipe(current, site, seed, id, 30, recipes[30]), site, seed, id, 40, recipes[40]);
    }, 'Receptura pro 30 a 40 cm byla uložena.')) dialog.close();
  }
  if (form.id === 'new-order-form') {
    if (await transact(current => addOrder(current, site, {branchId, source: data.get('source'), fulfillment: data.get('fulfillment'), payment: data.get('payment'), label: data.get('label'), lines: draft}).state, 'Nová objednávka čeká na potvrzení.')) { dialog.close(); setView('orders'); sourceFilter = 'all'; render(); }
  }
});
window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY || !site) return;
  try { state = restoreState(event.newValue, site, seed); render(); notify('Data aktualizována z jiného okna.'); }
  catch { notify('Uložená data se změnila. Obnovte administraci.', true); }
});
async function init() {
  try {
    const responses = await Promise.all([fetch('../data/site.json'), fetch('./seed.json')]);
    if (responses.some(r => !r.ok)) throw new Error('Nepodařilo se načíst menu nebo receptury.');
    [site, seed] = await Promise.all(responses.map(r => r.json()));
    await locked(async () => {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw !== null) state = restoreState(raw, site, seed);
      else { const initial = createDemoState(site, seed); localStorage.setItem(STORAGE_KEY, JSON.stringify(initial)); state = initial; }
    });
    $('#branch').innerHTML = site.branches.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
    const previousBranch = sessionStorage.getItem('pizza-visi-admin-branch');
    if (site.branches.some(b => b.id === previousBranch)) branchId = previousBranch;
    $('#branch').value = branchId;
    const clock = () => { $('#clock').textContent = new Date().toLocaleTimeString('cs-CZ', {hour: '2-digit', minute: '2-digit'}); };
    clock(); setInterval(clock, 30000);
    setView(['orders', 'stock', 'recipes', 'history'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'orders');
  } catch (error) {
    state = null;
    $('#workspace').innerHTML = `<div class="empty-state"><h1>Administraci nelze otevřít</h1><p>${esc(error.message)}</p><p>Zkontrolujte připojení a povolení místního úložiště. Poškozená uložená data nepřepisujeme.</p><button class="secondary-button" onclick="location.reload()">Zkusit znovu</button></div>`;
  }
}
init();
