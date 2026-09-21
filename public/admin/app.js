import {stockSummary, batchStatus, daysLeft, localDay, updateBatch, discardBatch} from './inventory.js';
import {STORAGE_KEY, SOURCES, pizzas, products, pizzaName, createDemoState, ensureDemoDeliveryOrders, restoreState, addOrder, requirements, transitionOrder, restock, saveRecipeCells} from './model.js?v=c90b50e8';
import {normalizeSearch, itemPrice} from '../menu-utils.js';
import {COURIERS, deliveryOrders, deliveryPlan, deliveryAssignment, saveDeliveryPlan, platformCourier, toggleDeliveryStop} from './delivery.js?v=bb45e9a7';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const money = value => `${new Intl.NumberFormat('cs-CZ').format(value)} Kč`;
const number = value => new Intl.NumberFormat('cs-CZ', {maximumFractionDigits: 3}).format(value);
const when = value => new Date(value).toLocaleString('cs-CZ', {day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit'});
const sourceNames = {web: 'Pizza Visi', pos: 'Pokladna', wolt: 'Wolt', foodora: 'foodora', bolt: 'Bolt Food'};
const statusNames = {new: 'Nové', confirmed: 'Potvrzené', preparing: 'V přípravě', ready: 'Předat kurýrovi', completed: 'Dokončené', cancelled: 'Zrušené'};
let site, seed, state, busy = false, branchId = 'rudna', view = 'orders', sourceFilter = 'all', search = '', stockFilter = 'all', toastTimer;
let draft = [], catalogSize = 30, catalogCategory = 'pizzy', editorOrder;
let recipeChanges = new Map(), pizzaSearch = '', ingredientSearch = '';
let routeDraft, routeBefore, routeBranch, selectedCourier = 1;
const dateText = day => day ? day.split('-').reverse().join('.') : 'Neuvedeno';
const stockInfo = id => stockSummary(state, branchId, id);
const expiryCaption = day => !day ? 'Chybí datum' : daysLeft(day) < 0 ? `Prošlé ${Math.abs(daysLeft(day))} d` : daysLeft(day) === 0 ? 'Spotřebovat dnes' : `Zbývá ${daysLeft(day)} d`;
const dialog = $('#editor');
const branch = () => site.branches.find(b => b.id === branchId);
const branchOrders = () => state.orders.filter(o => o.branchId === branchId);
const ingredient = id => seed.ingredients.find(i => i.id === id);
const stopsText = count => `${count} ${count === 1 ? 'zastávka' : count >= 2 && count <= 4 ? 'zastávky' : 'zastávek'}`;
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
async function transact(change, message, redraw = true) {
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
    if (redraw) render(); notify(message); return true;
  } catch (error) { showError(error); return false; }
  finally { busy = false; }
}
function heading(eyebrow, title, description, action = '') {
  return `<header class="page-heading"><h1>${title}</h1><div class="heading-actions">${action}</div></header>`;
}
function render() {
  document.body.dataset.view = view;
  $('#rail-count').textContent = branchOrders().filter(o => !['completed', 'cancelled'].includes(o.status)).length;
  $('#stock-alert').hidden = !seed.ingredients.some(i => (stockInfo(i.id).available <= i.minimum || stockInfo(i.id).expired > 0 || stockInfo(i.id).undated > 0));
  document.querySelectorAll('button[data-view]').forEach(b => b.setAttribute('aria-current', b.dataset.view === view ? 'page' : 'false'));
  if (view === 'orders') renderOrders();
  if (view === 'stock') renderStock();
  if (view === 'recipes') renderRecipes();
  if (view === 'history') renderHistory();
}
function renderOrders() {
  const active = branchOrders().filter(o => !['completed', 'cancelled'].includes(o.status));
  const shown = active.filter(o => sourceFilter === 'all' || o.source === sourceFilter);
  $('#workspace').innerHTML = heading(`PROVOZ / ${esc(branch().name)}`, 'Objednávky', `<span class="live-dot"></span> ${active.length} aktivních objednávek · přehled kuchyně a výdeje`, '<button class="secondary-button delivery-plan-button" data-plan-delivery>Naplánovat rozvoz</button><button class="primary-button" data-new-order>＋ Nová objednávka</button>') +
    `<div class="orders-board">${['new', 'confirmed', 'preparing', 'ready'].map(status => `<section class="order-column" data-column="${status}" aria-label="${statusNames[status]}"><header class="column-header"><strong><i></i>${statusNames[status]}</strong><span>${shown.filter(o => o.status === status).length}</span></header><div class="column-list">${shown.filter(o => o.status === status).map(orderCard).join('') || '<p class="column-empty">Všechno vyřízeno.<br>Tady je zatím klid.</p>'}</div></section>`).join('')}</div>
    <footer class="orders-footer"><div class="channel-toolbar" role="group" aria-label="Filtrovat podle zdroje"><button data-source="all" aria-pressed="${sourceFilter === 'all'}">Všechny <b>${active.length}</b></button>${SOURCES.map(source => `<button data-source="${source}" aria-pressed="${sourceFilter === source}">${sourceBadge(source)}<b>${active.filter(o => o.source === source).length}</b></button>`).join('')}<span class="channels-note">Ukázkové kanály</span></div><span class="sr-only">Sklad se odečítá při zahájení přípravy</span><button class="text-button" data-go="history">Historie objednávek ↗</button></footer>`;
}
function orderCard(order) {
  const action = {new: 'Potvrdit objednávku', confirmed: 'Začít připravovat', preparing: 'Hotovo → k předání', ready: handoffAction(order)}[order.status];
  return `<article class="order-card is-${order.source}"><div class="card-top"><strong>#${esc(order.id.split('-')[1])}</strong>${sourceBadge(order.source)}</div><div class="card-time">${when(order.createdAt)}${order.fulfillment === 'pickup' ? ` · ${esc(order.label)}` : ''}</div><div class="order-items">${order.lines.map(l => `<div><b>${l.quantity}×</b><span><strong>${esc(l.name)}</strong><small>${l.size ? `${l.size} cm` : 'nápoj'}</small></span></div>`).join('')}</div>${order.fulfillment === 'delivery' ? `<div class="card-recipient"><strong>${esc(order.label || 'Jméno neuvedeno')}</strong><span>${esc(order.deliveryAddress || 'Adresa neuvedena')}</span></div>` : '<p class="fulfillment">↗ Vyzvednutí na pobočce</p>'}<div class="payment-line"><span>${{cash: 'Hotově', card: 'Karta · demo', online: 'Online · demo'}[order.payment]}</span><strong>${money(order.total)}</strong></div>${order.deduction ? '<p class="deducted">✓ Suroviny odečteny</p>' : ''}<button class="advance-order" data-order="${esc(order.id)}">${action}</button></article>`;
}
function handoffAction(order) {
  const provider = platformCourier(order);
  return provider ? `Předat kurýrovi ${sourceNames[provider]}` : order.fulfillment === 'pickup' ? 'Předat zákazníkovi' : 'Předat kurýrovi';
}
function courierCaption(order) {
  const provider = platformCourier(order);
  if (provider) return `Vlastní kurýr ${sourceNames[provider]}`;
  const assignment = deliveryAssignment(state, order);
  return assignment ? `Kurýr ${assignment.courierId} · ${assignment.position}. zastávka` : 'Kurýr nepřiřazen';
}
function openDeliveryPlanner() {
  routeBranch = branchId;
  routeBefore = deliveryPlan(state, routeBranch);
  routeDraft = structuredClone(routeBefore);
  selectedCourier = 1;
  openDialog('Naplánovat rozvoz', 'Vyberte kurýra a klepejte na objednávky v pořadí zastávek.', '<div id="delivery-planner"></div><footer class="dialog-footer"><p id="delivery-plan-status" role="status"></p><button class="secondary-button" data-close>Zrušit</button><button class="primary-button" id="save-delivery-plan" data-save-delivery-plan>Uložit rozvoz</button></footer>', 'delivery-dialog');
  renderDeliveryPlanner();
}
function renderDeliveryPlanner(focusSelector) {
  const orders = deliveryOrders(state, routeBranch).sort((a,b) => a.createdAt.localeCompare(b.createdAt));
  const route = routeDraft[selectedCourier - 1];
  const listScroll = $('#delivery-order-list')?.scrollTop || 0, routeScroll = $('#courier-stops')?.scrollTop || 0;
  const count = routeDraft.flat().length;
  $('#delivery-planner').innerHTML = `<div class="courier-tabs" role="group" aria-label="Vybrat kurýra">${COURIERS.map(id => `<button data-courier="${id}" aria-pressed="${id === selectedCourier}"><span class="courier-avatar">${id}</span><span>Kurýr ${id}<small>${stopsText(routeDraft[id - 1].length)}</small></span><span class="courier-selected" aria-hidden="true">${id === selectedCourier ? '✓' : ''}</span></button>`).join('')}</div>
    <div class="delivery-layout"><section class="delivery-orders"><div class="delivery-section-heading"><h3>Objednávky k rozvozu <span>${orders.length}</span></h3><p>Vlastní rozvoz z webu a pokladny. Wolt, Bolt Food a foodora mají své kurýry.</p></div><div id="delivery-order-list">${orders.map(order => {
      const assigned = routeDraft.findIndex(ids => ids.includes(order.id)), position = assigned < 0 ? 0 : routeDraft[assigned].indexOf(order.id) + 1;
      const selected = assigned === selectedCourier - 1, locked = assigned >= 0 && !selected, shortId = order.id.split('-')[1];
      const action = locked ? `#${shortId} má kurýr ${assigned + 1}; nejdřív odeberte z jeho trasy` : selected ? `Odebrat #${shortId} z trasy` : `Přiřadit #${shortId} kurýrovi ${selectedCourier}`;
      return `<button class="delivery-order ${selected ? 'is-selected' : ''} ${locked ? 'is-assigned' : ''}" ${locked ? 'disabled' : ''} data-plan-order="${esc(order.id)}" aria-label="${action}" aria-pressed="${selected}"><span class="stop-number">${locked ? '✓' : selected ? position : '+'}</span><span class="delivery-order-info"><span class="delivery-order-top"><strong>#${esc(shortId)} <span>${esc(order.label)}</span></strong>${sourceBadge(order.source)}</span><span class="delivery-address">${esc(order.deliveryAddress || 'Adresa není vyplněná')}</span><span class="delivery-order-items">${order.lines.map(line => `${line.quantity}× ${esc(line.name)}`).join(' · ')}</span><span class="delivery-order-meta"><span class="delivery-state ${order.status === 'ready' ? 'is-ready' : ''}">${order.status === 'ready' ? 'Připraveno' : statusNames[order.status]}</span><span>${assigned < 0 ? 'Bez kurýra' : `Kurýr ${assigned + 1} · ${position}. zastávka`}</span><span>${money(order.total)}</span></span></span></button>`;
    }).join('') || '<p class="delivery-empty">Žádné objednávky pro vlastní kurýry.<br>Rozvozy Wolt, Bolt Food a foodora zajišťují jejich řidiči.</p>'}</div></section>
    <section class="courier-route"><div class="delivery-section-heading"><h3>Trasa · Kurýr ${selectedCourier}</h3><p>Pořadí upravíte šipkami. Odebrání vrátí objednávku do výběru.</p></div><ol id="courier-stops">${route.map((id,index) => {
      const order = orders.find(order => order.id === id);
      if (!order) return `<li class="route-stale">#${esc(id.split('-')[1])} už není k rozvozu. <button class="route-control" data-remove-stop="${esc(id)}" aria-label="Odebrat #${esc(id.split('-')[1])}">×</button></li>`;
      return `<li data-route-stop="${id}" tabindex="-1"><span class="stop-number">${index + 1}</span><div class="route-stop-info"><strong>#${esc(id.split('-')[1])} · ${esc(order.label)}</strong><span>${esc(order.deliveryAddress || 'Adresa není vyplněná')}</span><small>${order.status === 'ready' ? 'Připraveno k předání' : statusNames[order.status]}</small></div><div class="route-controls"><button class="route-control" data-move-stop="${id}" data-direction="-1" aria-label="Posunout #${esc(id.split('-')[1])} dříve" ${index === 0 ? 'disabled' : ''}>↑</button><button class="route-control" data-move-stop="${id}" data-direction="1" aria-label="Posunout #${esc(id.split('-')[1])} později" ${index === route.length - 1 ? 'disabled' : ''}>↓</button><button class="route-control" data-remove-stop="${id}" aria-label="Odebrat #${esc(id.split('-')[1])}">×</button></div></li>`;
    }).join('') || '<li class="delivery-empty">Trasa je zatím prázdná.<br>První vybraná objednávka dostane číslo 1.</li>'}</ol><p class="delivery-hint">Jedna objednávka = jeden kurýr. Pro změnu ji nejdřív odeberte z původní trasy.</p></section></div>`;
  $('#delivery-plan-status').textContent = `Přiřazeno ${count} z ${orders.length} objednávek`;
  $('#save-delivery-plan').disabled = JSON.stringify(routeDraft) === JSON.stringify(routeBefore);
  $('#delivery-order-list').scrollTop = listScroll; $('#courier-stops').scrollTop = routeScroll;
  if (focusSelector) {
    const target = $(focusSelector);
    target?.focus({preventScroll: true});
    if (target?.hasAttribute('data-route-stop')) target.scrollIntoView({block: 'nearest'});
  }
}
function stockStats() {
  return `<footer class="stock-summary"><span>${seed.ingredients.length} surovin</span><span>${seed.ingredients.filter(i => stockInfo(i.id).available <= i.minimum).length} pod minimem</span><span>${pizzas(site).length} receptur · 30 cm</span><span>Nejdříve se vydávají šarže s nejbližší spotřebou (FEFO).</span></footer>`;
}
function renderStock() {
  $('#workspace').innerHTML = heading('', 'Sklad', '', '<button class="primary-button" data-restock="">＋ Naskladnit</button>') +
  `<div class="panel stock-panel"><div class="panel-toolbar"><label class="search-field"><span>⌕</span><input id="stock-search" type="search" placeholder="Najít surovinu…" aria-label="Hledat surovinu" value="${esc(search)}"></label><select id="stock-filter" aria-label="Filtrovat sklad">${[['all','Všechny suroviny'],['low','Pod minimem'],['soon','Spotřeba do 3 dnů'],['expired','Prošlé šarže'],['undated','Chybí datum spotřeby']].map(([id,label])=>`<option value="${id}" ${stockFilter===id?'selected':''}>${label}</option>`).join('')}</select><span class="muted">${esc(branch().name)} · g / ml</span></div><div class="table-scroll stock-scroll"><table><thead><tr><th>Surovina</th><th class="numeric">Použitelné</th><th class="numeric">Minimum</th><th>Poslední příjem</th><th>Nejbližší spotřeba</th><th>Stav</th><th>Šarže / příjem</th></tr></thead><tbody id="stock-rows"></tbody></table></div></div>${stockStats()}<details class="movement-details"><summary>Historie skladových pohybů <span>Posledních 20 záznamů</span></summary><div class="movement-list">${movementRows()}</div></details>`;
  renderStockRows();
}
function renderStockRows() {
  const rows = seed.ingredients.filter(i => {
    const q = stockInfo(i.id);
    const selected = stockFilter === 'all' || (stockFilter === 'low' && q.available <= i.minimum) || (stockFilter === 'expired' && q.expired > 0) || (stockFilter === 'undated' && q.undated > 0) || (stockFilter === 'soon' && state.batches.some(b => b.branchId === branchId && b.ingredientId === i.id && batchStatus(b) === 'soon'));
    return normalizeSearch(i.name).includes(normalizeSearch(search)) && selected;
  });
  $('#stock-rows').innerHTML = rows.map(i => {
    const q = stockInfo(i.id);
    const tone = q.expired ? 'expired' : q.undated ? 'undated' : q.available <= i.minimum ? 'low' : q.nearest && daysLeft(q.nearest) <= 3 ? 'soon' : 'ok';
    const label = {expired:'Prošlé zásoby',undated:'Doplnit datum',low:'Naskladnit',soon:'Spotřeba brzy',ok:'V pořádku'}[tone];
    return `<tr><td><strong>${esc(i.name)}</strong></td><td class="numeric stock-amount">${quantity(q.available, i.unit)}${q.available !== q.total ? `<small>Celkem ${quantity(q.total,i.unit)}</small>`:''}</td><td class="numeric muted">${quantity(i.minimum,i.unit)}</td><td>${dateText(q.lastReceived)}<small>${q.batchCount} ${q.batchCount===1?'šarže':'šarží'} na skladě</small></td><td class="expiry-cell ${tone}">${dateText(q.nearest)}<small>${q.undated ? `${quantity(q.undated,i.unit)} bez data` : q.nearest ? expiryCaption(q.nearest) : 'Žádná zásoba'}</small></td><td><span class="stock-status ${tone}">${label}</span></td><td><div class="row-actions"><button class="small-button" data-batches="${i.id}" aria-label="Šarže ${esc(i.name)}">Šarže</button><button class="small-button plus-button" data-restock="${i.id}" aria-label="Naskladnit ${esc(i.name)}">＋</button></div></td></tr>`;
  }).join('') || '<tr><td colspan="7" class="empty-state">Žádná surovina neodpovídá filtru.</td></tr>';
}
function movementRows() {
  const labels = {in:'Naskladnění',out:'Výdej do přípravy',waste:'Vyřazení zásoby',correction:'Úprava šarže'};
  return state.movements.filter(m => m.branchId === branchId).slice(0,20).map(m=>`<article class="movement"><span class="movement-icon ${m.type}">${m.type==='in'?'↙':'↗'}</span><div><strong>${labels[m.type]} ${m.orderId ? '#'+esc(m.orderId.split('-')[1]):''}${m.lot ? ' · '+esc(m.lot):''}</strong><p>${Object.entries(m.amounts).map(([id,amount])=>`${esc(ingredient(id).name)} ${m.type==='in'?'+':'−'}${quantity(amount,ingredient(id).unit)}`).join(' · ')}</p>${m.note?`<small>${esc(m.note)}</small>`:''}${m.after ? `<small>Spotřeba: ${dateText(m.before?.expiresOn)} → ${dateText(m.after.expiresOn)}</small>`:''}</div><time>${when(m.at)}</time></article>`).join('') || '<p class="empty-state">Zatím žádný pohyb ve skladu.</p>';
}
function renderRecipes() {
  const previousScroll = $('.matrix-scroll');
  const position = {left: previousScroll?.scrollLeft || 0, top: previousScroll?.scrollTop || 0};
  $('#workspace').innerHTML = heading('', 'Receptury <small>30 cm</small>', '', '<button class="secondary-button" id="recipes-discard" data-discard-recipes disabled>Zrušit změny</button><button class="primary-button" id="recipes-save" data-save-recipes disabled>Uložit změny</button>')+
  `<div class="recipe-tools"><label class="search-field"><input type="search" id="pizza-search" placeholder="Najít pizzu…" aria-label="Hledat pizzu v recepturách" value="${esc(pizzaSearch)}"></label><label class="search-field"><input type="search" id="ingredient-search" placeholder="Najít surovinu / sloupec…" aria-label="Hledat sloupec suroviny" value="${esc(ingredientSearch)}"></label><span id="recipe-save-status" role="status"></span></div><div class="table-scroll matrix-scroll" tabindex="0" aria-label="Receptury: vodorovně posuňte pro další suroviny"><table class="recipe-matrix" id="recipe-matrix"></table></div><footer class="matrix-help"><strong>Množství na 1 pizzu · g / ml</strong><span>Prázdné pole = nepoužívá se. Ukázkové normy lze přepsat. Posunutím doprava zobrazíte další suroviny.</span></footer>`;
  renderMatrix(); recipeSaveStatus();
  $('.matrix-scroll').scrollTo(position);
}
function renderMatrix() {
  const cols = seed.ingredients.filter(i=>normalizeSearch(i.name).includes(normalizeSearch(ingredientSearch)));
  const rows = pizzas(site).filter(p=>normalizeSearch(pizzaName(p)).includes(normalizeSearch(pizzaSearch)));
  $('#recipe-matrix').innerHTML = `<thead><tr><th class="pizza-column">Pizza / 30 cm</th>${cols.map(i=>`<th scope="col">${esc(i.name)}</th>`).join('')}</tr></thead><tbody>${rows.map(p=>`<tr><th scope="row" class="pizza-column"><span>${String(p.number).padStart(2,'0')}</span>${esc(pizzaName(p))}</th>${cols.map(i=>{
    const key=p.id+':'+i.id, change=recipeChanges.get(key), amount=change?change.amount:(state.recipes[p.id][30][i.id]||0);
    return `<td class="${change?'edited':''}"><label class="recipe-quantity"><input type="number" inputmode="numeric" min="0" max="10000" step="1" placeholder="—" value="${amount||''}" data-cell-pizza="${p.id}" data-cell-ingredient="${i.id}" aria-label="${esc(pizzaName(p))} / ${esc(i.name)} (${i.unit})"><span class="recipe-unit" aria-hidden="true">${esc(i.unit)}</span></label></td>`;
  }).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length+1}">Žádná pizza neodpovídá hledání.</td></tr>`}</tbody>`;
}
function recipeSaveStatus() {
  $('#recipes-save').disabled = !recipeChanges.size;
  $('#recipes-discard').disabled = !recipeChanges.size;
  $('#recipe-save-status').textContent = recipeChanges.size ? `Neuložené buňky: ${recipeChanges.size}` : 'Vše uloženo';
}
function openBatches(id) {
  const i=ingredient(id), q=stockInfo(id);
  const batches=state.batches.filter(b=>b.branchId===branchId && b.ingredientId===id && b.remaining>0).sort((a,b)=>(a.expiresOn||'9999').localeCompare(b.expiresOn||'9999'));
  openDialog(`Šarže · ${esc(i.name)}`, `Použitelné ${quantity(q.available,i.unit)} / celkem ${quantity(q.total,i.unit)}.`, `<div class="batch-panel"><p class="inline-note">Prošlé šarže a šarže bez data spotřeby jsou blokované. Při přípravě se použije nejbližší platné datum spotřeby.</p><div class="table-scroll"><table class="batches-table"><thead><tr><th>Šarže</th><th>Zbývá</th><th>Příjem</th><th>Spotřebovat do</th><th>Akce</th></tr></thead><tbody>${batches.map(b=>`<tr><td><strong>${esc(b.lot)}</strong><small>${esc(b.id)}</small></td><td>${quantity(b.remaining,i.unit)}</td><td>${dateText(b.receivedOn)}</td><td class="${batchStatus(b)}">${dateText(b.expiresOn)}<small>${expiryCaption(b.expiresOn)}</small></td><td><div class="row-actions"><button class="small-button" data-edit-batch="${b.id}">Upravit</button><button class="small-button danger-text" data-discard-batch="${b.id}">Vyřadit</button></div></td></tr>`).join('')||'<tr><td colspan="5">Žádná zásoba.</td></tr>'}</tbody></table></div></div><footer class="dialog-footer"><button class="secondary-button" data-close>Zavřít</button><button class="primary-button" data-restock="${id}">＋ Naskladnit</button></footer>`, 'batches-dialog');
}
function editBatch(id) {
  const b=state.batches.find(b=>b.id===id);
  openDialog(`Upravit šarži · ${esc(ingredient(b.ingredientId).name)}`, 'Doplňte skutečné údaje z příjmu a obalu suroviny.', `<form class="dialog-form" id="batch-form" data-batch="${id}"><label>Označení šarže<input name="lot" value="${esc(b.lot)}" maxlength="60" required></label><div class="form-columns"><label>Datum příjmu<input type="date" name="receivedOn" max="${localDay()}" value="${b.receivedOn||''}" required></label><label>Spotřebovat do<input type="date" name="expiresOn" value="${b.expiresOn||''}" required></label></div><p class="inline-note">Úprava se zaznamená do historie. Množství zásoby zůstane stejné.</p><footer class="dialog-footer"><button type="button" class="secondary-button" data-batches="${b.ingredientId}">Zpět</button><button class="primary-button">Uložit šarži</button></footer></form>`);
}
function openDiscardBatch(id) {
  const b=state.batches.find(b=>b.id===id),i=ingredient(b.ingredientId);
  openDialog('Vyřadit zásobu', `${esc(i.name)} · ${esc(b.lot)} · ${quantity(b.remaining,i.unit)}`, `<form id="discard-batch-form" class="dialog-form" data-batch="${id}"><p class="inline-note">Vyřadí se celý zbývající obsah této šarže. Výdej a důvod zůstanou v historii.</p><label>Důvod<input name="reason" maxlength="100" placeholder="Např. prošlá trvanlivost" required></label><footer class="dialog-footer"><button type="button" class="secondary-button" data-batches="${b.ingredientId}">Zpět</button><button class="primary-button">Potvrdit vyřazení</button></footer></form>`);
}
function renderHistory() {
  const orders = branchOrders().filter(o => ['completed', 'cancelled'].includes(o.status));
  $('#workspace').innerHTML = heading(`ARCHIV / ${esc(branch().name)}`, 'Historie objednávek', 'Dokončené a zrušené demo objednávky. Odečty zůstávají v historii skladu.') + `<div class="panel table-scroll"><table><thead><tr><th>Objednávka</th><th>Zdroj</th><th>Položky</th><th>Stav</th><th>Celkem</th><th>Čas</th></tr></thead><tbody>${orders.map(o => `<tr><td><strong>#${esc(o.id.split('-')[1])}</strong><small>${esc(o.label)}</small></td><td>${sourceBadge(o.source)}</td><td>${o.lines.map(l => `${l.quantity}× ${esc(l.name)}${l.size ? ` ${l.size} cm` : ''}`).join('<br>')}</td><td>${o.handoff ? `Předáno kurýrovi<small>${o.handoff.provider ? sourceNames[o.handoff.provider] : `Kurýr ${o.handoff.courierId} · ${o.handoff.position}. zastávka`}</small>` : statusNames[o.status]}</td><td>${money(o.total)}</td><td>${when(o.updatedAt)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty-state">První dokončené objednávky se objeví tady.</td></tr>'}</tbody></table></div>`;
}
function openDialog(title, subtitle, content, className = '') {
  dialog.className = className;
  $('#dialog-content').innerHTML = `<header class="dialog-header"><div><p class="eyebrow">PIZZA VISI / ${esc(branch().name)}</p><h2 id="dialog-title">${title}</h2><p>${subtitle}</p></div><button type="button" class="close-button" data-close aria-label="Zavřít okno">×</button></header><p id="dialog-error" role="alert" class="error-box" hidden></p>${content}`;
  if (!dialog.open) dialog.showModal();
}
function openRestock(id) {
  const chosen = ingredient(id) || seed.ingredients[0];
  openDialog('Naskladnit suroviny', `Příjem do skladu pobočky ${esc(branch().name)}.`, `<form id="restock-form" class="dialog-form"><label>Surovina<select id="stock-ingredient" name="ingredient">${seed.ingredients.map(i => `<option value="${i.id}" ${chosen.id === i.id ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}</select></label><div class="form-columns"><label>Množství<input name="amount" type="number" min="0.001" step="0.001" max="10000000" placeholder="Např. 5" required autofocus></label><label>Jednotka<select name="unit" id="stock-unit"></select></label></div><p id="restock-preview" class="inline-note"></p><label>Označení šarže<input name="lot" maxlength="60" placeholder="Číslo z obalu (nepovinné)"></label><div class="form-columns"><label>Datum příjmu<input type="date" name="receivedOn" value="${localDay()}" max="${localDay()}" required></label><label>Spotřebovat do<input type="date" name="expiresOn" required></label></div><label>Poznámka <span class="muted">nepovinné</span><input name="note" maxlength="100" placeholder="Např. ranní dodávka"></label><footer class="dialog-footer"><button type="button" class="secondary-button" data-close>Zrušit</button><button class="primary-button" type="submit">Potvrdit naskladnění</button></footer></form>`);
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
function openOrder(id) {
  const order = state.orders.find(o => o.id === id);
  if (!order || ['completed', 'cancelled'].includes(order.status)) return;
  editorOrder = id;
  let needs;
  try { needs = order.deduction ? Object.entries(order.deduction.amounts).map(([id, needed]) => ({...ingredient(id), needed})) : requirements(state, order, seed); }
  catch (error) { return notify(error.message, true); }
  const shortage = needs.some(i => i.missing > 0);
  const stockCaption = order.deduction ? 'Odečtené suroviny · záznam při zahájení' : 'Odečte se při zahájení přípravy';
  const minutes = Math.max(10, Math.min(180, Math.round((Number(order.minutes) || 30) / 10) * 10));
  const stockDetail = `<section class="order-stock"><details><summary><span>Suroviny a sklad</span><span class="stock-overview">${order.deduction ? 'Odečteno' : shortage ? 'K doplnění' : 'Skladem'}</span></summary><p class="stock-caption">${stockCaption}</p><div class="deduction-list">${needs.map(i => `<div><span>${esc(i.name)}</span><strong>−${quantity(i.needed, i.unit)}</strong>${i.missing ? `<small>Chybí ${quantity(i.missing, i.unit)}</small>` : ''}</div>`).join('') || '<p class="muted">Nápoje neodečítají suroviny pro pizzu.</p>'}</div></details>${shortage ? '<p class="stock-warning">Před přípravou doplňte chybějící suroviny. Objednávku lze zatím potvrdit.</p>' : ''}</section>`;
  const timePicker = ['new', 'confirmed'].includes(order.status)
    ? `<div class="eta-picker"><div class="eta-heading"><label for="order-minutes">Připravit za</label><output id="order-minutes-value" for="order-minutes">${minutes} <span>min</span></output></div><input id="order-minutes" type="range" min="10" max="180" step="10" value="${minutes}" aria-valuetext="${minutes} minut" aria-describedby="order-minutes-help" style="--eta-progress:${(minutes - 10) / 170 * 100}%"><div class="eta-scale"><span>10 min</span><span id="order-minutes-help">Po 10 minutách</span><span>180 min</span></div></div>`
    : '<p class="inline-note">Sklad už byl odečten. Posun objednávky jej znovu nezmění.</p>';
  const assignment = deliveryAssignment(state, order);
  const deliveryDetail = order.fulfillment === 'delivery' ? `<div class="order-delivery"><div><span>${esc(order.deliveryAddress || 'Adresa není vyplněná')}</span><strong>${courierCaption(order)}</strong></div>${platformCourier(order) ? '' : `<button class="small-button" data-plan-delivery>${assignment ? 'Upravit rozvoz' : 'Vybrat kurýra'}</button>`}</div>` : '';
  let buttons = '';
  if (order.status === 'new') buttons = `<button class="secondary-button" data-transition="confirmed">Jen potvrdit</button><button class="primary-button" data-transition="preparing">Potvrdit a připravovat</button>`;
  if (order.status === 'confirmed') buttons = '<button class="primary-button" data-transition="preparing">Začít přípravu a odečíst sklad</button>';
  if (order.status === 'preparing') buttons = '<button class="primary-button" data-transition="ready">Hotovo → k předání</button>';
  if (order.status === 'ready') buttons = `<button class="primary-button" data-transition="completed" ${order.fulfillment === 'delivery' && !platformCourier(order) && !assignment ? 'disabled' : ''}>${handoffAction(order)}</button>`;
  openDialog(`Objednávka #${esc(id.split('-')[1])}`, `${esc(order.label)} · ${statusNames[order.status]} · ${when(order.createdAt)}`, `<div class="order-detail"><div class="detail-source">${sourceBadge(order.source)}<strong>${money(order.total)}</strong></div><div class="detail-items">${order.lines.map(l => `<div><span>${l.quantity}× ${esc(l.name)} ${l.size ? `· ${l.size} cm` : ''}</span><strong>${money(l.quantity * l.unitPrice)}</strong></div>`).join('')}<div class="muted"><span>Krabice / rozvoz</span><span>${money(order.packaging)} / ${money(order.delivery)}</span></div></div>${deliveryDetail}${stockDetail}${timePicker}</div><footer class="dialog-footer">${['new', 'confirmed'].includes(order.status) ? '<button class="text-button danger-text" data-cancel-order>Zrušit objednávku</button>' : ''}<div class="footer-actions">${buttons}</div></footer>`, 'order-dialog');
}
function openNewOrder() {
  draft = []; catalogSize = 30; catalogCategory = 'pizzy';
  openDialog('Nová objednávka', 'Ukázkový prodej na pobočce nebo z libovolného kanálu.', `<form id="new-order-form"><div class="new-order-layout"><section class="catalog-pane" aria-label="Nabídka"><div class="catalog-tools"><select id="catalog-category" aria-label="Kategorie"><option value="pizzy">Pizzy · 24</option><option value="napoje">Nápoje</option><option value="vino-prosecco">Víno a prosecco</option></select><span class="fixed-size">Pizzy pouze 30 cm</span></div><div id="product-grid" class="product-grid"></div></section><aside class="cart-pane"><div class="cart-form"><h3>Košík</h3><div id="cart-lines"></div><div class="form-columns"><label>Zdroj<select name="source" id="order-source">${SOURCES.map(s => `<option value="${s}" ${s === 'pos' ? 'selected' : ''}>${sourceNames[s]}</option>`).join('')}</select></label><label>Předání<select name="fulfillment" id="fulfillment"><option value="pickup">Vyzvednutí</option><option value="delivery">Doručení</option></select></label></div><label id="delivery-address-field" hidden>Adresa doručení <span class="muted">nepovinné · demo</span><input name="deliveryAddress" maxlength="180" placeholder="Ulice, číslo domu, obec"></label><label><span id="order-label-caption">Označení</span><input name="label" value="Demo objednávka" maxlength="80" placeholder="Označení objednávky" required></label><label>Platba<select name="payment"><option value="cash">Hotově</option><option value="card">Kartou · demo</option><option value="online">Online · demo</option></select></label></div><footer class="cart-checkout"><div id="draft-total"></div><p class="inline-note">Demo platba · sklad se odečte při přípravě.</p><button class="primary-button" id="create-order" type="submit" disabled>Vytvořit objednávku</button></footer></aside></div></form>`, 'new-order-dialog');
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
function syncDraftFulfillment() {
  const provider = platformCourier({source: $('#order-source').value});
  const field = $('#fulfillment');
  field.disabled = Boolean(provider);
  if (provider) field.value = 'delivery';
  field.querySelector('option[value="delivery"]').textContent = provider ? `Kurýr ${sourceNames[provider]}` : 'Doručení';
  $('#delivery-address-field').hidden = field.value !== 'delivery';
  $('#order-label-caption').textContent = field.value === 'delivery' ? 'Jméno příjemce' : 'Označení';
  $('#new-order-form').elements.label.placeholder = field.value === 'delivery' ? 'Jméno a příjmení' : 'Označení objednávky';
  renderDraft();
}
function setView(next) { if (!['orders', 'stock', 'recipes', 'history'].includes(next)) return; if (recipeChanges.size && next !== 'recipes') { notify('Nejdřív uložte nebo zrušte změny receptur.', true); return; } view = next; history.replaceState(null, '', `#${next}`); render(); $('#workspace').scrollTop = 0; window.scrollTo({top: 0, behavior: 'instant'}); }

document.addEventListener('click', async event => {
  const button = event.target.closest('button'); if (!button || busy || !state) return;
  if (button.hasAttribute('data-view')) return setView(button.dataset.view);
  if (button.hasAttribute('data-go')) return setView(button.dataset.go);
  if (button.hasAttribute('data-source')) { sourceFilter = button.dataset.source; return renderOrders(); }
  if (button.hasAttribute('data-close')) return dialog.close();
  if (button.hasAttribute('data-restock')) return openRestock(button.dataset.restock);
  if (button.hasAttribute('data-batches')) return openBatches(button.dataset.batches);
  if (button.hasAttribute('data-edit-batch')) return editBatch(button.dataset.editBatch);
  if (button.hasAttribute('data-discard-batch')) return openDiscardBatch(button.dataset.discardBatch);
  if (button.hasAttribute('data-discard-recipes')) { recipeChanges.clear(); return renderRecipes(); }
  if (button.hasAttribute('data-save-recipes')) {
    const invalid = [...document.querySelectorAll('[data-cell-pizza]')].find(input => !input.checkValidity());
    if (invalid) return invalid.reportValidity();
    if (await transact(current => saveRecipeCells(current, site, seed, [...recipeChanges.values()]), 'Receptury 30 cm byly uloženy.', false)) { recipeChanges.clear(); renderRecipes(); }
    return;
  }
  if (button.hasAttribute('data-order')) return openOrder(button.dataset.order);
  if (button.hasAttribute('data-new-order')) return openNewOrder();
  if (button.hasAttribute('data-plan-delivery')) return openDeliveryPlanner();
  if (button.hasAttribute('data-courier')) {
    selectedCourier = Number(button.dataset.courier);
    return renderDeliveryPlanner(`[data-courier="${selectedCourier}"]`);
  }
  if (button.hasAttribute('data-plan-order')) {
    const id = button.dataset.planOrder;
    try { routeDraft = toggleDeliveryStop(routeDraft, selectedCourier, id); }
    catch (error) { return showError(error); }
    return renderDeliveryPlanner(`[data-plan-order="${id}"]`);
  }
  if (button.hasAttribute('data-remove-stop')) {
    const id = button.dataset.removeStop;
    routeDraft = routeDraft.map(route => route.filter(orderId => orderId !== id));
    return renderDeliveryPlanner(`[data-plan-order="${id}"]`);
  }
  if (button.hasAttribute('data-move-stop')) {
    const route = routeDraft[selectedCourier - 1], index = route.indexOf(button.dataset.moveStop), next = index + Number(button.dataset.direction);
    if (index >= 0 && next >= 0 && next < route.length) [route[index], route[next]] = [route[next], route[index]];
    return renderDeliveryPlanner(`[data-route-stop="${button.dataset.moveStop}"]`);
  }
  if (button.hasAttribute('data-save-delivery-plan')) {
    if (await transact(current => saveDeliveryPlan(current, routeBranch, routeDraft, routeBefore), 'Plán rozvozu byl uložen.')) dialog.close();
    return;
  }

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
  if (event.target.id === 'stock-filter') { stockFilter = event.target.value; renderStockRows(); }
  if (event.target.id === 'stock-ingredient') stockUnits();
  if (event.target.id === 'stock-unit') stockPreview();
  if (event.target.id === 'catalog-category') { catalogCategory = event.target.value; renderCatalog(); }
  if (['fulfillment', 'order-source'].includes(event.target.id)) syncDraftFulfillment();
});
document.addEventListener('input', event => {
  if (event.target.id === 'order-minutes') {
    const minutes = Number(event.target.value);
    $('#order-minutes-value').innerHTML = `${minutes} <span>min</span>`;
    event.target.setAttribute('aria-valuetext', `${minutes} minut`);
    event.target.style.setProperty('--eta-progress', `${(minutes - 10) / 170 * 100}%`);
  }
  if (event.target.hasAttribute('data-cell-pizza')) {
    const input = event.target, pizzaId = input.dataset.cellPizza, ingredientId = input.dataset.cellIngredient, key = pizzaId + ':' + ingredientId;
    const before = recipeChanges.get(key)?.before ?? (state.recipes[pizzaId][30][ingredientId] || 0);
    const amount = input.validity.badInput ? NaN : Number(input.value);
    if (amount === before) recipeChanges.delete(key); else recipeChanges.set(key, {pizzaId, ingredientId, before, amount});
    input.closest('td').classList.toggle('edited', recipeChanges.has(key)); recipeSaveStatus();
  }
  if (event.target.id === 'pizza-search') { pizzaSearch = event.target.value; renderMatrix(); }
  if (event.target.id === 'ingredient-search') { ingredientSearch = event.target.value; renderMatrix(); }
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
    if (await transact(current => restock(current, seed, branchId, data.get('ingredient'), amount, {note:data.get('note'),lot:data.get('lot'),receivedOn:data.get('receivedOn'),expiresOn:data.get('expiresOn')}), 'Surovina byla naskladněna.')) dialog.close();
  }
  if (form.id === 'batch-form') {
    const id=form.dataset.batch;
    if (await transact(current=>updateBatch(current,id,{lot:data.get('lot'),receivedOn:data.get('receivedOn'),expiresOn:data.get('expiresOn')}),'Šarže byla upravena.')) openBatches(state.batches.find(b=>b.id===id).ingredientId);
  }
  if (form.id === 'discard-batch-form') {
    const id=form.dataset.batch, ingredientId=state.batches.find(b=>b.id===id).ingredientId;
    if (await transact(current=>discardBatch(current,id,data.get('reason')),'Zásoba byla vyřazena a zapsána do historie.')) openBatches(ingredientId);
  }
  if (form.id === 'new-order-form') {
    if (await transact(current => addOrder(current, site, {branchId, source: data.get('source'), fulfillment: form.elements.fulfillment.value, payment: data.get('payment'), label: data.get('label'), deliveryAddress: data.get('deliveryAddress'), lines: draft}).state, 'Nová objednávka čeká na potvrzení.')) { dialog.close(); setView('orders'); sourceFilter = 'all'; render(); }
  }
});
window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY || !site) return;
  try { state = restoreState(event.newValue, site, seed); if (!recipeChanges.size) render(); notify('Data aktualizována z jiného okna.'); }
  catch { notify('Uložená data se změnila. Obnovte administraci.', true); }
});
async function init() {
  try {
    const responses = await Promise.all([fetch('../data/site.json'), fetch('./seed.json')]);
    if (responses.some(r => !r.ok)) throw new Error('Nepodařilo se načíst menu nebo receptury.');
    [site, seed] = await Promise.all(responses.map(r => r.json()));
    await locked(async () => {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw !== null) {
        const restored = restoreState(raw, site, seed);
        state = ensureDemoDeliveryOrders(restored, site);
        if (state !== restored || JSON.parse(raw).version !== state.version || JSON.parse(raw).courierPolicyVersion !== state.courierPolicyVersion) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      }
      else { const initial = createDemoState(site, seed); localStorage.setItem(STORAGE_KEY, JSON.stringify(initial)); state = initial; }
    });
    $('#branch').innerHTML = site.branches.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
    const previousBranch = sessionStorage.getItem('pizza-visi-admin-branch');
    if (site.branches.some(b => b.id === previousBranch)) branchId = previousBranch;
    $('#branch').value = branchId;
    let displayedDay = localDay();
    const clock = () => {
      $('#clock').textContent = new Date().toLocaleTimeString('cs-CZ', {hour: '2-digit', minute: '2-digit'});
      if (state && displayedDay !== localDay() && !dialog.open && !recipeChanges.size) { displayedDay = localDay(); render(); }
    };
    clock(); setInterval(clock, 30000);
    setView(['orders', 'stock', 'recipes', 'history'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'orders');
  } catch (error) {
    state = null;
    $('#workspace').innerHTML = `<div class="empty-state"><h1>Administraci nelze otevřít</h1><p>${esc(error.message)}</p><p>Zkontrolujte připojení a povolení místního úložiště. Poškozená uložená data nepřepisujeme.</p><button class="secondary-button" onclick="location.reload()">Zkusit znovu</button></div>`;
  }
}
window.addEventListener('beforeunload', event => { if (recipeChanges.size) { event.preventDefault(); event.returnValue = ''; } });
init();
