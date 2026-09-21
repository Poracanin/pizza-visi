import {demoQrSvg} from './courier-qr.js?v=1';
import {hasSampleMap, clearSampleMaps, mountSampleMaps} from './courier-maps.js?v=1';
import {STORAGE_KEY, restoreState, createState} from './admin/model.js?v=16388c99';
import {PREVIEW_KEY, ISSUE_REASONS, createCourierPreview, upgradeCourierPreviewAddresses, validateCourierState, courierOrders, courierHistory, deliveryStatus, takeOrder, finishDelivery, setDeliveryIssue, courierPaymentQuote, collectDemoPayment, courierPaymentTotals} from './courier-model.js?v=3';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = value => new Intl.NumberFormat('cs-CZ', {style:'currency',currency:'CZK',minimumFractionDigits:0,maximumFractionDigits:2}).format(value);
const when = value => new Date(value).toLocaleTimeString('cs-CZ', {hour:'2-digit',minute:'2-digit',timeZone:'Europe/Prague'});
const day = value => new Date(value).toLocaleDateString('sv-SE', {timeZone:'Europe/Prague'});
const paths = {
  pin:'<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  route:'<circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M9 19h6a4 4 0 0 0 0-8H9a4 4 0 0 1 0-8h3"/>',
  arrow:'<path d="m5 12 14 0m-6-6 6 6-6 6"/>',
  nav:'<path d="m3 10 18-7-7 18-3-8-8-3Z"/>',
  phone:'<path d="m8 3 2 5-3 2a15 15 0 0 0 7 7l2-3 5 2v3a2 2 0 0 1-2 2C10 21 3 14 3 5a2 2 0 0 1 2-2Z"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  bag:'<path d="M4 8h16l1 13H3L4 8Z"/><path d="M8 8V6a4 4 0 0 1 8 0v2"/>',
  wallet:'<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 9V5l14-3v3m4 7h-6v5h6M17 14.5h.01"/>',
  qr:'<path d="M3 3h6v6H3Zm12 0h6v6h-6ZM3 15h6v6H3Zm12 0h3v3h3v3h-6Zm6-3v3M12 3v3M3 12h3m3 0h6m-3 3v6"/>',
  tap:'<path d="M7 8a6 6 0 0 1 0 8m4-11a10 10 0 0 1 0 14M15 2a14 14 0 0 1 0 20M3 11a2 2 0 0 1 0 2"/>',
  card:'<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h3"/>',
  refresh:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1"/>',
  alert:'<path d="m12 3 10 18H2L12 3Zm0 6v5m0 3h.01"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>'
};
const icon = name => `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.bag}</svg>`;
const statusNames = {driving:'Na cestě',ready:'K převzetí',waiting:'V přípravě',issue:'Řeší se problém',delivered:'Doručeno'};
const paymentNames = {cash:'Hotově',card:'Kartou',qr:'QR platba',online:'Online'};
let paymentDraft = null;
const PRESET_KEY = 'pizza-visi-courier-settings-v1';
let site, seed, state, branchId = 'rudna', courierId = 1, mode = 'preview', view = 'route', filter = 'all', busy = false, sheetOrder = null, fatal = false, toastTimer;
const sheet = $('#sheet');
const keyFor = value => value === 'admin' ? STORAGE_KEY : PREVIEW_KEY;
const lock = (key, fn) => navigator.locks ? navigator.locks.request(key, fn) : fn();
const branch = () => site.branches.find(b => b.id === branchId);
const active = () => courierOrders(state, branchId, courierId);
const history = () => courierHistory(state, branchId, courierId);
const todayHistory = () => history().filter(o => day(o.courierDelivery.deliveredAt) === day(new Date()));
const mapUrl = address => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}&travelmode=driving`;
const isSample = order => order.courierPreview || order.demoDeliverySample;
const phoneUrl = phone => /^[+\d\s()\-]{6,25}$/.test(phone || '') && phone.replace(/\D/g,'').length >= 6 ? `tel:${phone.replace(/[^+\d]/g,'')}` : null;
function notify(message, error = false) {
  clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').className = `visible${error ? ' error' : ''}`;
  toastTimer = setTimeout(() => { $('#toast').className = ''; }, 4500);
}
function read(key) {
  const raw = localStorage.getItem(key);
  if (raw === null) return null;
  return validateCourierState(restoreState(raw, site, seed));
}
async function loadCurrent() {
  const selectedMode = mode, key = keyFor(selectedMode);
  await lock(key, () => {
    const restored = read(key);
    if (restored) {
      state = selectedMode === 'preview' ? upgradeCourierPreviewAddresses(restored, site) : restored;
      if (state !== restored) { state.revision = restored.revision + 1; localStorage.setItem(key, JSON.stringify(state)); }
    }
    else if (selectedMode === 'preview') {
      const initial = createCourierPreview(site, seed);
      localStorage.setItem(key, JSON.stringify(initial)); state = initial;
    } else state = createState(site, seed);
  });
}
function showFatal(error) {
  fatal = true; sheet.close(); $('#navigation').hidden = true; $('#profile').disabled = true;
  $('#main').innerHTML = `<div class="empty">${icon('alert')}<h1>ROZVOZY NELZE NAČÍST</h1><p>${esc(error.message)}</p><p>Uložená data zůstala zachovaná. Zkontrolujte povolení úložiště a obnovte stránku.</p><button class="primary" data-action="reload">Zkusit znovu</button></div>`;
}
function heading(title, subtitle) {
  return `<div class="heading"><div><span class="eyebrow">Pizza Visi / kurýr ${courierId}</span><h1>${title}</h1><p>${esc(subtitle)}</p></div><button class="icon-button" data-action="refresh" aria-label="Obnovit rozvozy">${icon('refresh')}</button></div>`;
}
function statusBadge(order) {
  const status = deliveryStatus(order);
  const label = status === 'waiting' ? ({new:'Čeká na potvrzení',confirmed:'Potvrzeno',preparing:'V přípravě'}[order.status] || statusNames.waiting) : statusNames[status];
  return `<span class="status ${status}">${label}</span>`;
}
function address(order) {
  const parts = String(order.deliveryAddress || '').split(',');
  return `<div class="address-block"><span class="address-pin">${icon('pin')}</span><div class="address-copy"><small>${esc(parts.slice(1).join(',').trim() || branch().name)}</small><h3>${esc(parts[0] || 'Adresa neuvedena')}</h3><p>${esc(order.label)}</p></div></div>`;
}
function paymentRow(order, completed = false) {
  const receipt = order.courierPayment, paid = Boolean(receipt || order.courierDelivery?.deliveredAt || order.payment === 'online');
  const method = receipt?.method || order.payment, total = order.total + (receipt?.tip || 0);
  return `<div class="payment-row ${paid && !completed ? 'online' : ''}"><span class="payment-label">${icon(method === 'online' ? 'check' : method === 'cash' ? 'wallet' : method)}${esc(paymentNames[method] || 'Neznámá platba')}${order.payment === 'online' && receipt ? ' · dýško' : ''}</span><strong>${paid && !completed ? 'Zaplaceno · demo' : money(total)}</strong></div>${receipt?.tip ? `<p class="fine">Včetně dýška ${money(receipt.tip)}${order.payment === 'online' ? ' · objednávka uhrazena online' : ''}</p>` : ''}`;
}
function navigation(order, label = 'Navigovat', style = 'secondary') {
  if (!order.deliveryAddress?.trim()) return `<button class="${style}" disabled>Adresa chybí</button>`;
  if (isSample(order) && !order.courierMapSample) return `<button class="${style}" data-action="demo-map">${icon('nav')}${label}</button>`;
  return `<a class="${style}" href="${esc(mapUrl(order.deliveryAddress))}" target="_blank" rel="noopener noreferrer">${icon('nav')}${label}</a>`;
}
function mapPreview(order) {
  if (!order?.courierMapSample || !hasSampleMap(order.deliveryAddress)) return '';
  const query = encodeURIComponent(order.deliveryAddress + ', Česko');
  return `<section class="delivery-map" aria-label="Mapa ukázkové zastávky"><div class="map-heading"><span>${icon('pin')}Ukázková mapa</span><a href="https://www.google.com/maps/search/?api=1&query=${query}" target="_blank" rel="noopener noreferrer">Zvětšit mapu ↗</a></div><div class="sample-map" data-sample-map="${esc(order.deliveryAddress)}" role="region" aria-label="Mapa: ${esc(order.deliveryAddress)}"></div><div class="map-caption"><span>${icon('pin')}</span><div><strong>${esc(order.deliveryAddress)}</strong><small>Veřejné místo · ukázková cílová adresa</small></div></div></section>`;
}
function card(order, index, first) {
  const status = deliveryStatus(order), next = first && ['driving','issue'].includes(status);
  const count = order.lines.reduce((sum, line) => sum + line.quantity, 0);
  const action = ['ready','waiting'].includes(status) ? 'Detail a převzetí' : status === 'issue' ? 'Vyřešit problém' : 'Předat objednávku';
  return `<article class="stop-card ${next ? 'next' : ''}">${next ? '<div class="next-flag">DALŠÍ ZASTÁVKA<span>Ve vašem pořadí</span></div>' : ''}<div class="stop-body"><div class="card-meta">${statusBadge(order)}<span>#${esc(order.id.slice(5))} · ${index + 1}. v pořadí</span></div>${address(order)}${order.requestedAt ? `<p class="fine" style="margin-top:10px">${icon('clock')} Předání na čas · ${esc(new Date(order.requestedAt).toLocaleString('cs-CZ', {timeZone:'Europe/Prague',day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'}))}</p>` : ''}<div class="card-preview"><b>${count} ks</b> · ${order.lines.map(line => `${line.quantity}× ${esc(line.name)}`).join(' · ')}</div>${paymentRow(order)}${status === 'issue' ? `<p class="issue-note">${icon('alert')}${esc(order.courierDelivery.issue)}</p>` : ''}<div class="card-actions">${navigation(order)}<button class="${next ? 'primary' : 'secondary'}" data-order="${order.id}">${action}</button></div></div></article>`;
}
function routePage() {
  const orders = active(), driving = orders.filter(o => ['driving','issue'].includes(deliveryStatus(o))), pending = orders.filter(o => ['ready','waiting'].includes(deliveryStatus(o)));
  const list = filter === 'driving' ? driving : filter === 'pending' ? pending : orders;
  return `${heading('MŮJ ROZVOZ', `${branch().name} · ${new Date().toLocaleDateString('cs-CZ',{day:'numeric',month:'long',timeZone:'Europe/Prague'})}`)}${mapPreview(list[0])}<div class="stats"><div class="stat"><strong>${driving.length}</strong><span>Na cestě</span></div><div class="stat"><strong>${pending.length}</strong><span>Na pobočce</span></div><div class="stat"><strong>${todayHistory().length}</strong><span>Dnes doručeno</span></div></div><div class="filters" aria-label="Filtr rozvozů">${[['all','Vše',orders.length],['driving','Na cestě',driving.length],['pending','Na pobočce',pending.length]].map(([id,label,count]) => `<button data-filter="${id}" aria-pressed="${filter === id}">${label}<b>${count}</b></button>`).join('')}</div><div class="stop-list">${list.length ? list.map(order => card(order, orders.indexOf(order), order === orders[0])).join('') : `<div class="empty">${icon('check')}<h2>${orders.length ? 'TADY JE TEĎ PRÁZDNO' : history().length ? 'VŠECHNO VYŘÍZENO' : 'ZATÍM ŽÁDNÉ ZASTÁVKY'}</h2><p>${orders.length ? 'V tomto filtru nemáte žádný rozvoz.' : mode === 'admin' ? 'Další objednávky se objeví, až vám je pobočka přiřadí v plánu rozvozu.' : history().length ? 'Všechny zastávky máte za sebou. Doručení najdete v historii.' : 'Ukázkové zastávky má kurýr 1. Přepněte kurýra v nastavení nahoře.'}</p>${mode === 'admin' && !orders.length ? '<a class="secondary" href="./admin/#orders" target="_blank" rel="noopener">Otevřít administraci ↗</a>' : ''}</div>`}</div><p class="demo-note">${mode === 'preview' ? 'Ukázkoví zákazníci a rozvozy. Mapy používají adresy veřejných míst; nejde o skutečné objednávky.' : 'Vlastní rozvozy Pizza Visi. Wolt, foodora a Bolt Food používají své kurýry.'}</p>`;
}
function historyPage() {
  const orders = history();
  return `${heading('DORUČENÉ', `${branch().name} · kurýr ${courierId}`)}<div class="overview-card"><small>Doručeno dnes</small><strong>${todayHistory().length} OBJEDNÁVEK</strong><p class="fine">Hotové zastávky a potvrzení plateb v tomto demu.</p></div><div class="section-head"><h2>Historie doručení</h2><span>${orders.length} záznamů</span></div>${orders.length ? orders.map(order => `<button class="history-row" data-order="${order.id}"><span class="check-icon">${icon('check')}</span><span class="history-info"><strong>${esc(order.label)}</strong><small>#${order.id.slice(5)} · ${esc(order.deliveryAddress)}</small></span><span class="history-amount">${money(order.total + (order.courierPayment?.tip || 0))}<small>${new Date(order.courierDelivery.deliveredAt).toLocaleDateString('cs-CZ',{day:'numeric',month:'numeric',timeZone:'Europe/Prague'})} · ${when(order.courierDelivery.deliveredAt)}</small></span></button>`).join('') : `<div class="empty">${icon('clock')}<h2>PRVNÍ DORUČENÍ ČEKÁ</h2><p>Po potvrzení předání zákazníkovi se objednávka zobrazí tady.</p><button class="secondary" data-view="route">Zpět na rozvozy</button></div>`}`;
}
function overviewPage() {
  const done = todayHistory();
  const settled = [...active(), ...history()].filter(o => {
    const date = o.courierPayment?.confirmedAt || o.courierDelivery?.deliveredAt;
    return date && day(date) === day(new Date());
  });
  const totals = courierPaymentTotals(settled);
  const outstanding = active().filter(o => o.payment === 'cash' && !o.courierPayment).reduce((s,o) => s + o.total,0);
  return `${heading('MŮJ PŘEHLED', `${branch().name} · dnešní demo směna`)}<section class="overview-card"><small>${icon('wallet')} Převzatá hotovost dnes</small><strong>${money(totals.cash)}</strong><p class="fine">Potvrzené hotovostní úhrady včetně hotovostního dýška.</p></section><section class="overview-card"><div class="summary-row"><span>Ještě vybrat hotově</span><strong>${money(outstanding)}</strong></div>${[['card','Kartou · demo'],['qr','QR platby · demo'],['online','Online · demo'],['tips','Z toho dýško celkem']].map(([key,label]) => `<div class="summary-row"><span>${label}</span><strong>${money(totals[key])}</strong></div>`).join('')}<div class="summary-row"><span>Dnes doručeno</span><strong>${done.length}×</strong></div></section><p class="fine">Platby jsou ukázkové. Comgate ani platební terminál nejsou připojené. Dýško je již zahrnuté v částkách jednotlivých plateb.</p><section class="branch-card"><span class="eyebrow">Vaše pobočka</span><h2>Pizza Visi ${esc(branch().name)}</h2><p>${esc(branch().address)}</p><a class="secondary" href="${esc(branch().phone_uri)}">${icon('phone')}Zavolat na pobočku</a><a class="secondary" href="${esc(mapUrl(branch().address))}" target="_blank" rel="noopener noreferrer">${icon('nav')}Navigovat zpět</a><button class="text-button full" data-action="settings">Pobočka a nastavení</button></section>`;
}
function render() {
  if (fatal || !state) return;
  $('#profile').disabled = false; $('#profile').textContent = `K${courierId}`;
  $('#mode-banner').innerHTML = `<span class="demo-label">DEMO</span><span>${mode === 'preview' ? 'Ukázková trasa' : 'Rozvozy z administrace'}</span><span class="local-dot">V zařízení</span>`;
  clearSampleMaps($('#main'));
  $('#main').innerHTML = view === 'history' ? historyPage() : view === 'overview' ? overviewPage() : routePage();
  mountSampleMaps($('#main'));
  $('#navigation').hidden = false;
  $('#navigation').innerHTML = [['route','Trasa','route'],['history','Doručené','check'],['overview','Přehled','wallet']].map(([id,label,symbol]) => `<button data-view="${id}" ${view === id ? 'aria-current="page"' : ''}>${icon(symbol)}${id === 'route' && active().length ? `<span class="nav-count">${active().length}</span>` : ''}<span>${label}</span></button>`).join('');
}
function openSheet(title, eyebrow, content) {
  clearSampleMaps($('#sheet-content'));
  $('#sheet-content').innerHTML = `<header class="sheet-head"><div><span class="eyebrow">${esc(eyebrow)}</span><h2 id="sheet-title">${esc(title)}</h2></div><button class="icon-button" data-action="close" aria-label="Zavřít detail">${icon('close')}</button></header><div class="sheet-body"><p id="sheet-error" class="error-box" role="alert" hidden></p>${content}</div>`;
  if (!sheet.open) sheet.showModal();
  sheet.scrollTop = 0;
  mountSampleMaps($('#sheet-content'));
}
function openOrder(id) {
  const order = [...active(), ...history()].find(o => o.id === id);
  if (!order) return notify('Objednávka už není v tomto rozvozu.', true);
  sheetOrder = structuredClone(order); paymentDraft = null;
  const status = deliveryStatus(order), tel = isSample(order) ? null : phoneUrl(order.phone);
  let action = '';
  if (status === 'ready') action = `<form id="take-form"><label class="check-field"><input name="checked" type="checkbox" required><span>Mám všechny položky objednávky a přebírám je na rozvoz.</span></label><button class="primary full" type="submit">${icon('bag')}Převzít na rozvoz</button></form>`;
  else if (status === 'waiting') action = `<p class="setting-info">Objednávka se připravuje. Převzít ji můžete, jakmile ji obsluha označí jako připravenou.</p>`;
  else if (status === 'delivered') action = `<p class="setting-info"><strong>${icon('check')} Doručeno ${new Date(order.courierDelivery.deliveredAt).toLocaleDateString('cs-CZ',{timeZone:'Europe/Prague'})} v ${when(order.courierDelivery.deliveredAt)}</strong><br>Potvrzení je uložené v historii kurýra ${courierId}.</p>`;
  else if (status === 'issue') action = `<div class="error-box">${icon('alert')} ${esc(order.courierDelivery.issue)}<br><span class="fine">Poznámka je uložená jen v tomto demu. Pokud potřebujete pomoc, zavolejte na pobočku.</span></div><a class="secondary full" href="${esc(branch().phone_uri)}">${icon('phone')}Zavolat na pobočku</a><button class="primary full" style="margin-top:10px" data-action="resolve">Problém vyřešen, pokračovat</button>`;
  else action = `${order.courierPayment ? `<div class="paid-notice">${icon('check')} Úhrada potvrzena · demo<span>${money(order.courierPayment.amount)} · ${paymentNames[order.courierPayment.method]}${order.courierPayment.tip ? ` · dýško ${money(order.courierPayment.tip)}` : ''}</span></div>` : `<button class="primary full" data-action="payment">${icon('wallet')}${order.payment === 'online' ? 'Přidat dýško' : 'Platba a dýško'}</button><p class="fine payment-hint">${order.payment === 'online' ? 'Objednávka už je zaplacená. Dýško je dobrovolné.' : 'Hotově, QR platbou nebo přiložením karty · demo'}</p>`}<form id="finish-form"><label class="check-field"><input name="delivered" type="checkbox" required><span>Objednávku jsem předal/a zákazníkovi.</span></label><button class="${order.courierPayment || order.payment === 'online' ? 'primary' : 'secondary'} full" type="submit" ${!order.courierPayment && order.payment !== 'online' ? 'disabled' : ''}>${icon('check')}Potvrdit doručení</button><p class="fine">${!order.courierPayment && order.payment !== 'online' ? 'Nejdříve potvrďte ukázkovou úhradu tlačítkem výše.' : 'Uloží ukázkové doručení. Žádná platba se neprovede.'}</p></form><button class="text-button" data-action="issue">Problém s doručením</button>`;
  openSheet(`OBJEDNÁVKA #${order.id.slice(5)}`, `${branch().name} · ${statusNames[status]}`, `${address(order)}<div class="contact-actions">${navigation(order)}${tel ? `<a class="secondary" href="${esc(tel)}">${icon('phone')}Zavolat</a>` : `<button class="secondary" disabled>${icon('phone')}${isSample(order) ? 'Demo kontakt' : 'Telefon chybí'}</button>`}</div>${mapPreview(order)}${order.phone && tel ? `<p class="fine">Telefon: ${esc(order.phone)}</p>` : ''}${order.note ? `<div class="customer-note"><small>POZNÁMKA ZÁKAZNÍKA</small>${esc(order.note)}</div>` : ''}<h3 class="detail-label">Obsah objednávky</h3><ul class="item-list">${order.lines.map(line => `<li><b>${line.quantity}×</b><span>${esc(line.name)}<small>${line.size ? `${line.size} cm` : 'Nápoj'}</small></span><strong>${money(line.quantity * line.unitPrice)}</strong></li>`).join('')}</ul><div class="fees"><span>Krabice</span><span>${money(order.packaging)}</span></div><div class="fees"><span>Rozvoz</span><span>${money(order.delivery)}</span></div><div class="payment-box">${paymentRow(order, true)}<p class="fine">${order.courierPayment ? 'Ukázková úhrada je uložená. Znovu nic nevybíráte.' : status === 'delivered' ? 'Úhrada potvrzena v rámci ukázkového doručení.' : order.payment === 'online' ? 'V ukázce zaplaceno online. Přidat lze dobrovolné dýško.' : order.payment === 'cash' ? 'K vybrání při předání zákazníkovi.' : 'Způsob úhrady si zvolíte níže. Terminál funguje jako ukázka.'}</p></div>${action}`);
}
function openPayment(keepDraft = false) {
  const order = sheetOrder;
  if (!order || deliveryStatus(order) !== 'driving') return;
  if (order.courierPayment) return openPaymentReceipt();
  if (!keepDraft || paymentDraft?.id !== order.id) paymentDraft = {id:order.id, method:order.payment === 'cash' ? 'cash' : 'card', tip:0};
  const {method,tip} = paymentDraft;
  openSheet('PLATBA A DÝŠKO', `Objednávka #${order.id.slice(5)} · demo`, `<form id="payment-form"><div class="payment-order"><span>${esc(order.label)}</span><strong>${money(order.total)}</strong></div>${order.payment === 'online' ? '<p class="paid-notice compact">Objednávka je již zaplacená online. Vybíráte pouze dýško.</p>' : ''}<fieldset class="payment-fieldset"><legend>Způsob platby</legend><div class="payment-methods">${[['cash','Hotově','wallet'],['qr','QR platba','qr'],['card','Terminál','card']].map(([id,label,symbol]) => `<label class="method-option"><input type="radio" name="method" value="${id}" ${method === id ? 'checked' : ''} required><span>${icon(symbol)}${label}</span></label>`).join('')}</div></fieldset><fieldset class="payment-fieldset"><legend>Dýško pro kurýra <small>dobrovolné</small></legend><div class="tip-options">${[0,20,50,100].map(value => `<button type="button" class="tip-option" data-action="tip" data-tip="${value}" aria-pressed="${tip === value}">${value ? `+${value} Kč` : 'Bez dýška'}</button>`).join('')}</div><label class="field tip-field">Vlastní dýško v Kč<input id="tip-input" name="tip" type="number" inputmode="numeric" min="0" max="10000" step="1" value="${tip}" required aria-describedby="tip-help"></label><p class="fine" id="tip-help">Zadejte částku v celých korunách.</p></fieldset><div class="payment-breakdown"><div><span>${order.payment === 'online' ? 'Objednávka · uhrazeno online' : 'Objednávka'}</span><strong>${money(order.payment === 'online' ? 0 : order.total)}</strong></div><div><span>Dýško</span><strong id="payment-tip">${money(tip)}</strong></div><div class="payment-grand"><span>${order.payment === 'online' ? 'Dýško k úhradě' : 'Celkem k úhradě'}</span><strong id="payment-total" aria-live="polite"></strong></div></div><button id="payment-next" class="primary full" type="submit">Pokračovat ${icon('arrow')}</button><p class="fine payment-hint">Pouze ukázka. Žádné peníze se nestrhnou.</p></form><button class="text-button" data-action="order-back">Zpět k objednávce</button>`);
  updatePaymentQuote();
}
function updatePaymentQuote() {
  const form = $('#payment-form');
  if (!form || !sheetOrder) return;
  const input = $('#tip-input'), tip = input.value === '' ? NaN : Number(input.value), method = new FormData(form).get('method');
  document.querySelectorAll('[data-tip]').forEach(button => button.setAttribute('aria-pressed',String(Number(button.dataset.tip) === tip)));
  try {
    const quote = courierPaymentQuote(sheetOrder,method,tip);
    paymentDraft = {id:sheetOrder.id,...quote};
    $('#payment-tip').textContent = money(tip); $('#payment-total').textContent = money(quote.amount);
    $('#payment-next').disabled = quote.amount <= 0;
    $('#tip-help').textContent = 'Zadejte částku v celých korunách.';
  } catch(error) {
    $('#payment-tip').textContent = '—'; $('#payment-total').textContent = '—'; $('#payment-next').disabled = true;
    $('#tip-help').textContent = error.message;
  }
}
function openPaymentStep() {
  const order = sheetOrder, {method, amount, tip} = paymentDraft;
  const total = `<div class="payment-amount"><small>${order.payment === 'online' ? 'Dýško k úhradě' : 'Celkem k úhradě'}</small><strong>${money(amount)}</strong><span>${tip ? `Z toho dýško ${money(tip)}` : 'Bez dýška'}</span></div>`;
  let content;
  if (method === 'qr') content = `${total}<div class="qr-demo">${demoQrSvg(order.id,amount)}</div><p class="payment-instructions">Ukázkový QR kód</p><p class="fine payment-hint">Kód obsahuje jen text s ukázkovou částkou. Není určený pro bankovní aplikaci a neprovede převod.</p><button class="primary full" data-action="confirm-payment">${icon('check')}Simulovat zaplacení</button>`;
  else if (method === 'card') content = `<div class="terminal-demo"><div class="terminal-top"><span>PIZZA VISI</span><span>DEMO TERMINÁL</span></div>${total}<button class="tap-target" data-action="confirm-payment">${icon('tap')}<strong>Přiložit kartu · demo</strong><span>Klepněte pro simulaci pípnutí</span><span class="demo-bank-card">${icon('card')} UKÁZKOVÁ KARTA</span></button><p class="terminal-status"><i></i> Připraveno k ukázkové platbě</p></div><p class="fine payment-hint">Terminál není připojený. Žádná karta se nenačítá ani neúčtuje.</p>`;
  else content = `${total}<div class="cash-demo">${icon('wallet')}<p>Převzetí hotovosti</p><span>Potvrďte ukázkové převzetí částky včetně dýška.</span></div><button class="primary full" data-action="confirm-payment">${icon('check')}Potvrdit hotovost · demo</button>`;
  openSheet(method === 'qr' ? 'QR PLATBA' : method === 'card' ? 'PLATBA KARTOU' : 'PLATBA HOTOVĚ', `Objednávka #${order.id.slice(5)} · demo`, `${content}<button class="text-button" data-action="payment-back">Změnit částku nebo způsob platby</button>`);
}
function openPaymentReceipt() {
  const order = sheetOrder, receipt = order.courierPayment;
  openSheet('ÚHRADA POTVRZENA', `Objednávka #${order.id.slice(5)} · demo`, `<div class="payment-success" role="status"><span class="success-check">${icon('check')}</span><h3>${receipt.method === 'card' ? 'Píp. Hotovo!' : 'Hotovo, děkujeme!'}</h3><p>${paymentNames[receipt.method]} · ukázková úhrada</p><strong>${money(receipt.amount)}</strong><span>${receipt.tip ? `Včetně dýška ${money(receipt.tip)}` : 'Bez dýška'} · ${when(receipt.confirmedAt)}</span></div><p class="setting-info">Úhrada je uložená v tomto zařízení. Teď můžete potvrdit předání objednávky zákazníkovi.</p><button class="primary full" data-action="order-back">Pokračovat k doručení ${icon('arrow')}</button><p class="fine payment-hint">Šlo o simulaci. Žádné peníze se nepřevedly.</p>`);
}
document.addEventListener('input', event => { if (event.target.closest('#payment-form')) updatePaymentQuote(); });
function openSettings() {
  sheetOrder = null;
  openSheet('NASTAVENÍ ROZVOZU', 'Pizza Visi / demo', `<form id="settings-form"><label class="field">Pobočka<select name="branch">${site.branches.map(b => `<option value="${b.id}" ${b.id === branchId ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label><label class="field">Kurýr<select name="courier">${[1,2,3].map(id => `<option value="${id}" ${id === courierId ? 'selected' : ''}>Kurýr ${id}</option>`).join('')}</select></label><label class="field">Zobrazená data<select name="mode"><option value="preview" ${mode === 'preview' ? 'selected' : ''}>Ukázková trasa</option><option value="admin" ${mode === 'admin' ? 'selected' : ''}>Rozvozy z administrace</option></select></label><div class="setting-info"><strong>Vyzkoušejte jako kurýr 1</strong><br>Ukázková trasa má tři zastávky na každé pobočce, včetně hotovosti, karty a online platby.<br><br><strong>Propojení s administrací</strong><br>V administraci přiřaďte vlastní objednávku kurýrovi přes „Naplánovat rozvoz“. Tady se zobrazí ve stejném prohlížeči na stejné adrese webu.<br><br>Jde o demo bez přihlášení. Mezi telefonem a počítačem se data zatím nesdílejí.</div><button class="primary full" type="submit">Použít nastavení</button></form><hr class="section-divider"><a class="secondary full" href="./admin/#orders" target="_blank" rel="noopener">Otevřít administraci ↗</a>${mode === 'preview' ? '<button class="text-button" data-action="reset-preview">Obnovit ukázkovou trasu</button>' : ''}`);
}
function sheetError(error) {
  const box = $('#sheet-error');
  if (sheet.open && box) { box.hidden = false; box.textContent = error.message; box.scrollIntoView({block:'nearest'}); }
  else notify(error.message, true);
}
async function transact(change, message, onSaved) {
  if (busy || fatal) return false;
  busy = true;
  const key = keyFor(mode), expected = sheetOrder;
  const buttons = Array.from(sheet.querySelectorAll('button'), button => ({button, disabled:button.disabled})); buttons.forEach(({button}) => { button.disabled = true; });
  try {
    await lock(key, () => {
      const current = read(key);
      if (!current) throw new Error('Uložené rozvozy byly odstraněny. Obnovte stránku.');
      if (expected && JSON.stringify(current.orders.find(o => o.id === expected.id)) !== JSON.stringify(expected)) throw new Error('Objednávka se mezitím změnila. Zavřete detail a obnovte rozvozy.');
      const next = change(current);
      validateCourierState(next);
      if (next !== current) { next.revision = current.revision + 1; localStorage.setItem(key, JSON.stringify(next)); }
      state = next;
    });
    if (!onSaved) sheet.close();
    render();
    if (onSaved) { sheetOrder = structuredClone(state.orders.find(o => o.id === expected.id)); onSaved(); }
    notify(message); return true;
  } catch(error) { sheetError(error); return false; }
  finally { busy = false; buttons.forEach(({button,disabled}) => { button.disabled = disabled; }); }
}
function setView(next) {
  view = ['route','history','overview'].includes(next) ? next : 'route';
  render(); window.scrollTo(0,0); $('#main').focus({preventScroll:true});
}
document.addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button || button.disabled || busy) return;
  if (button.id === 'profile') return openSettings();
  if (button.dataset.view) return setView(button.dataset.view);
  if (button.dataset.filter) { filter = button.dataset.filter; render(); return; }
  if (button.dataset.order) return openOrder(button.dataset.order);
  switch(button.dataset.action) {
    case 'close': sheet.close(); break;
    case 'reload': location.reload(); break;
    case 'settings': openSettings(); break;
    case 'refresh':
      try { await loadCurrent(); render(); notify('Rozvozy aktualizované.'); } catch(error) { showFatal(error); }
      break;
    case 'demo-map':
      if (sheet.open) sheetError(new Error('Tato adresa je smyšlená. Navigace funguje u vlastních objednávek z administrace.'));
      else notify('Ukázková adresa. Navigaci vyzkoušejte s vlastní objednávkou.', true);
      break;
    case 'payment': openPayment(); break;
    case 'payment-back': openPayment(true); break;
    case 'order-back': if (sheetOrder) openOrder(sheetOrder.id); break;
    case 'tip': {
      const input = $('#tip-input');
      if (input) { input.value = button.dataset.tip; updatePaymentQuote(); }
      break;
    }
    case 'confirm-payment': {
      if (!sheetOrder || !paymentDraft) break;
      const id = sheetOrder.id, b = branchId, c = courierId, {method, tip} = paymentDraft;
      await transact(current => collectDemoPayment(current,id,b,c,method,tip), 'Ukázková úhrada uložena.', openPaymentReceipt);
      break;
    }
    case 'resolve': {
      const order = sheetOrder, b = branchId, c = courierId;
      await transact(current => setDeliveryIssue(current,order.id,b,c,null), 'Problém vyřešen. Můžete pokračovat v doručení.');
      break;
    }
    case 'issue':
      if (!sheetOrder) break;
      openSheet('PROBLÉM S DORUČENÍM', `Objednávka #${sheetOrder.id.slice(5)}`, `<form id="issue-form"><label class="field">Co se děje?<select name="reason">${ISSUE_REASONS.map(reason => `<option>${reason}</option>`).join('')}</select></label><p class="setting-info">Objednávka zůstane v rozvozu s označením problému. Záznam je pouze místní; pobočce se neposílá oznámení.</p><button class="primary full" type="submit">Uložit problém</button><a class="secondary full" style="margin-top:10px" href="${esc(branch().phone_uri)}">${icon('phone')}Zavolat na pobočku</a></form>`);
      break;
    case 'reset-preview':
      sheetOrder = null;
      openSheet('OBNOVIT UKÁZKU?', 'Ukázková trasa', '<p class="setting-info">Vrátí tři ukázkové zastávky na každé pobočce a odstraní historii této ukázky. Objednávky v administraci zůstanou zachované.</p><form id="reset-form"><button type="submit" class="primary full">Obnovit ukázkovou trasu</button></form>');
      break;
  }
});
document.addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  const form = event.target, data = new FormData(form), order = sheetOrder, b = branchId, c = courierId;
  if (form.id === 'settings-form') {
    const previous = {branchId,courierId,mode,state};
    const selection = {branchId:data.get('branch'),courierId:Number(data.get('courier')),mode:data.get('mode')};
    if (!site.branches.some(branch => branch.id === selection.branchId) || ![1,2,3].includes(selection.courierId) || !['preview','admin'].includes(selection.mode)) return;
    busy = true;
    try {
      ({branchId,courierId,mode} = selection); await loadCurrent();
      localStorage.setItem(PRESET_KEY, JSON.stringify(selection)); filter = 'all'; sheet.close(); setView('route');
    } catch(error) { ({branchId,courierId,mode,state} = previous); sheetError(error); }
    finally { busy = false; }
  }
  if (form.id === 'payment-form' && order) {
    try { paymentDraft = {id:order.id, ...courierPaymentQuote(order,data.get('method'),Number(data.get('tip')))}; openPaymentStep(); } catch(error) { sheetError(error); }
  }
  if (form.id === 'take-form' && order) await transact(current => takeOrder(current, order.id, b, c, seed), 'Objednávka převzatá. Je teď na cestě.');
  if (form.id === 'finish-form' && order) await transact(current => finishDelivery(current, order.id, b, c, false), 'Doručeno. Děkujeme, můžete na další zastávku.');
  if (form.id === 'issue-form' && order) await transact(current => setDeliveryIssue(current, order.id, b, c, data.get('reason')), 'Problém uložený u objednávky.');
  if (form.id === 'reset-form') {
    busy = true;
    try {
      await lock(PREVIEW_KEY, () => { const next = createCourierPreview(site, seed); localStorage.setItem(PREVIEW_KEY, JSON.stringify(next)); state = next; });
      mode = 'preview'; courierId = 1; filter = 'all';
      localStorage.setItem(PRESET_KEY, JSON.stringify({branchId,courierId,mode})); sheet.close(); setView('route'); notify('Ukázková trasa obnovena.');
    } catch(error) { sheetError(error); }
    finally { busy = false; }
  }
});
sheet.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
sheet.addEventListener('close', () => { sheetOrder = null; paymentDraft = null; clearSampleMaps($('#sheet-content')); });
window.addEventListener('storage', async event => {
  if (!site || fatal || (event.key !== null && event.key !== keyFor(mode))) return;
  try {
    if (sheetOrder && sheet.open) { sheet.close(); notify('Rozvozy se změnily v jiném okně. Otevřete detail znovu.'); }
    // A deleted key is not silently seeded while another tab resets its data.
    state = read(keyFor(mode)) || createState(site, seed); render();
  } catch(error) { showFatal(error); }
});
async function init() {
  try {
    const responses = await Promise.all([fetch('./data/site.json'), fetch('./admin/seed.json')]);
    if (responses.some(r => !r.ok)) throw new Error('Nepodařilo se načíst data poboček.');
    [site,seed] = await Promise.all(responses.map(r => r.json()));
    let settings = null;
    try { settings = JSON.parse(localStorage.getItem(PRESET_KEY)); } catch { /* Invalid preferences do not affect orders. */ }
    if (settings && site.branches.some(b => b.id === settings.branchId) && [1,2,3].includes(settings.courierId) && ['admin','preview'].includes(settings.mode)) ({branchId,courierId,mode} = settings);
    else {
      const admin = read(STORAGE_KEY);
      if (admin && activeForAnyCourier(admin)) mode = 'admin';
    }
    await loadCurrent(); render();
  } catch(error) { showFatal(error); }
}
function activeForAnyCourier(admin) {
  for (const b of site.branches) for (const c of [1,2,3]) if (courierOrders(admin,b.id,c).length) { branchId = b.id; courierId = c; return true; }
  return false;
}
let displayedDay = day(new Date());
setInterval(() => {
  const currentDay = day(new Date());
  if (currentDay !== displayedDay && state && !sheet.open && !busy) { displayedDay = currentDay; render(); }
}, 30000);
init();
