import { itemPrice, matchesItem, validBranch } from './menu-utils.js';
import { createDeliveryDialog } from './delivery-dialog.js';
import { createPrivacyBanner } from './privacy-banner.js';
import { loadRuianAddresses } from './ruian-addresses.js';
import { DELIVERY_PREFERENCE_KEY, STORAGE_CONSENT_KEY, parseRememberedSelection, canonicalSelection, serializeRememberedSelection, parseStorageConsent } from './delivery-preferences.js';
import { createOrdering } from './ordering.js?v=mobile-2';
import { showCartFeedback } from './cart-feedback.js';

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const icon = (name, extra = '') => `<svg class="icon ${extra}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const money = value => `${new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 }).format(value)} Kč`;
const cleanName = item => item.name.replace(/^\d+\.\s*/, '').replace(/\s*🌶️?/gu, '').trim();
const storageKey = 'pizza-visi-branch-v1';
const state = { data: null, branch: null, category: 'pizza', filter: 'all', query: '', menuView: 'tiles', afterBranch: null };
let ordering;
let deliveryChoice;
let privacyBanner;
let initialChoice = false;
let storageConsent = null;
let selection = { fulfillment: 'delivery', branchId: null, addressId: null, address: '', remember: false };
let preferenceVersion = 0;
function storageRead(key) { try { return localStorage.getItem(key); } catch { return null; } }
function storageWrite(key, value) { try { localStorage.setItem(key, value); return true; } catch { return false; } }
function forgetRememberedSelection() { try { localStorage.removeItem(DELIVERY_PREFERENCE_KEY); } catch { /* Browsing remains available. */ } }
function setStorageConsent(mode) {
  storageConsent = mode;
  storageWrite(STORAGE_CONSENT_KEY, JSON.stringify({ version: 1, mode }));
}
async function persistSelection() {
  const version = ++preferenceVersion;
  const current = { ...selection };
  if (!current.remember || (current.fulfillment === 'delivery' && !current.addressId)) { forgetRememberedSelection(); return; }
  try {
    const addresses = current.fulfillment === 'delivery' ? await loadRuianAddresses() : null;
    if (version !== preferenceVersion) return;
    const raw = serializeRememberedSelection(current, state.data, addresses);
    if (!storageWrite(DELIVERY_PREFERENCE_KEY, raw)) toast('Výběr platí pro tuto návštěvu. Prohlížeč jeho uložení nepovolil.');
  } catch { if (version === preferenceVersion) forgetRememberedSelection(); }
}
function onDeliveryChange(value) {
  selection = { ...value, remember: selection.remember };
  renderBranches();
  void persistSelection();
}
async function applySelection(value, { restoring = false, expectedVersion = preferenceVersion } = {}) {
  const addresses = value.fulfillment === 'delivery' ? await loadRuianAddresses() : null;
  if (restoring && (expectedVersion !== preferenceVersion || storageConsent === 'essential')) return false;
  const valid = canonicalSelection(value, state.data, addresses);
  if (!valid) throw new Error('Vyber prosím platnou adresu nebo pobočku.');
  const previousBranch = state.branch;
  state.branch = validBranch(state.data.branches, valid.branchId);
  try {
    const applied = await ordering.applyDeliverySelection(valid);
    if (!applied) throw new Error('Objednávka se právě ukládá. Zkus změnu za chvíli.');
  } catch (error) { state.branch = previousBranch; throw error; }
  storageWrite(storageKey, state.branch.id);
  selection = { ...valid, remember: Boolean(value.remember) };
  if (!restoring && selection.remember && storageConsent === 'essential') setStorageConsent('accepted');
  await persistSelection();
  renderBranches();
  return true;
}
let toastTimeout;

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => $('#toast').classList.remove('visible'), 3200);
}

function openDialog(dialog) {
  if (!dialog.open) dialog.showModal();
  document.body.classList.add('modal-open');
}

function openBranchDialog(options = {}) {
  if (!deliveryChoice) return;
  const request = typeof options === 'boolean' ? (options ? { fulfillment: 'delivery' } : {}) : options;
  initialChoice = Boolean(request.initial);
  deliveryChoice.open(request);
}

function branchCard(branch) {
  const selected = state.branch?.id === branch.id;
  const street = branch.address.replace(/, (Rudná \(u Prahy\)|Hostivice|Beroun)$/, '');
  return `<article class="branch-card ${selected ? 'selected' : ''}"><div class="branch-card-image"><img src="./${branch.image}" width="640" height="380" loading="lazy" alt="Pizzerie Pizza Visi ${escape(branch.name)}">${selected ? '<span class="selected-tag">Tvoje pobočka</span>' : ''}</div><div class="branch-card-content"><div class="branch-card-heading"><h3>${escape(branch.name)}</h3><span>0${state.data.branches.indexOf(branch) + 1}</span></div><p>${escape(street)}</p><span class="branch-hours">${icon('clock', 'icon-small')} Po–So · 11:00–21:00</span><a class="branch-phone" href="${branch.phone_uri}">${icon('phone', 'icon-small')} ${branch.phone}</a><button class="branch-card-select" data-select-branch="${branch.id}">${selected ? 'Vybraná pobočka' : 'Vybrat tuto pobočku'} ${icon(selected ? 'check' : 'arrow')}</button></div></article>`;
}

function renderBranches() {
  const hasAddress = selection.fulfillment === 'delivery' && selection.addressId;
  const mode = selection.fulfillment === 'pickup' ? 'Vyzvednutí' : hasAddress ? 'Doručení' : 'Kam to bude?';
  const label = hasAddress ? selection.address.split(',')[0] : state.branch?.name || 'Vybrat adresu';
  $('#header-branch').innerHTML = `<span class="delivery-header-mode">${mode}</span><span class="delivery-header-label">${escape(label)}</span>`;
  $('.branch-switch').setAttribute('aria-label', hasAddress ? `Upravit adresu: ${selection.address}` : `Upravit převzetí: ${label}`);
  $('.branch-switch').title = hasAddress ? `${selection.address} · Upravit adresu` : 'Změnit doručení nebo vyzvednutí';
  $('#branches-grid').innerHTML = state.data.branches.map(branch => branchCard(branch)).join('');
  renderDelivery();
  renderHero();
}

function renderHero() {
  const branch = state.branch;
  const hasAddress = selection.fulfillment === 'delivery' && selection.addressId;
  $('#hero-location-label').textContent = hasAddress ? 'Doručení na tvoji adresu · Upravit' : selection.fulfillment === 'pickup' ? 'Osobní vyzvednutí · Změnit' : 'Vyber doručení nebo vyzvednutí';
  $('#hero-location-name').textContent = branch?.name || 'Rudná · Hostivice · Beroun';
  $('#hero-location-address').textContent = hasAddress ? selection.address : branch?.address || 'Vyber si svoji pobočku';
}

function renderDelivery() {
  const branch = state.branch;
  const box = $('#delivery-card');
  if (!branch) {
    box.innerHTML = `<div class="delivery-empty"><div class="delivery-drawing">${icon('pin')}</div><p class="eyebrow">Rudná · Hostivice · Beroun</p><h3>KAM TO<br><em>BUDE?</em></h3><p>Vyber pobočku a zjisti,<br>kam všude za tebou přijedeme.</p><button class="button button-outline" data-choose-branch>Vybrat pobočku ${icon('arrow')}</button></div>`;
    return;
  }
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('Pizza Visi ' + branch.address)}`;
  box.innerHTML = `<div class="delivery-card-top"><div>${icon('pin')}<span class="eyebrow">Tvoje pobočka</span></div><button class="small-text-button" data-choose-branch>Změnit ↗</button></div><h3>${escape(branch.name)}</h3><p class="delivery-address">${escape(branch.address)}</p><div class="delivery-area-label">ROZVÁŽÍME DO TĚCHTO LOKALIT</div><div class="delivery-areas">${branch.delivery_areas.map(area => `<span>${escape(area)}</span>`).join('')}</div><div class="delivery-card-bottom"><a href="${branch.phone_uri}">${icon('phone', 'icon-small')} ${branch.phone}</a><a class="small-text-button" href="${mapUrl}" target="_blank" rel="noopener noreferrer">Najít na mapě ↗</a></div>`;
}

function selectBranch(id) {
  const branch = validBranch(state.data.branches, id);
  if (!branch) return;
  state.branch = branch;
  storageWrite(storageKey, branch.id);
  renderBranches();
  ordering?.branchChanged();
}

function categoryItems() {
  const categories = state.data.categories;
  const ids = { pizza: ['pizzy'], drinks: ['napoje'], wine: ['vino-prosecco'] }[state.category];
  return categories.filter(category => ids.includes(category.id)).flatMap(category => category.items.map(item => ({ ...item, categoryName: category.name })));
}

function renderMenu() {
  if (!state.data) return;
  const items = categoryItems().filter(item => matchesItem(item, state.query, state.category === 'pizza' ? state.filter : 'all'));
  const grid = $('#menu-grid');
  grid.classList.remove('compact-grid');
  grid.classList.toggle('menu-list', state.menuView === 'rows');
  grid.classList.toggle('beverage-grid', state.category !== 'pizza');
  grid.classList.toggle('wine-grid', state.category === 'wine');
  grid.classList.toggle('pizza-grid', state.category === 'pizza');
  grid.innerHTML = items.length ? items.map(item => {
    const spicy = item.name.includes('🌶');
    const productPrice = itemPrice(item, 30);
    if (state.category === 'pizza') return `<article class="pizza-card pizza-menu-card" data-pizza-card="${item.id}" data-menu-product="${item.id}" aria-labelledby="card-title-${item.id}">
      <button class="pizza-image-button" data-product="${item.id}" aria-label="Prohlédnout ${escape(cleanName(item))}"><img src="./${item.image}" alt="${escape(cleanName(item))}" width="600" height="600" loading="lazy"></button>
      <div class="pizza-card-copy"><div class="pizza-card-heading"><h3 id="card-title-${item.id}">${escape(cleanName(item))}</h3>${spicy ? `<span class="spicy-tag" role="img" aria-label="Pálivá">${icon('fire', 'icon-small')}</span>` : ''}</div>
      <p>${escape(item.description)}</p>
      <div class="pizza-card-bottom"><strong class="pizza-card-price">${itemPrice(item, 40) > productPrice ? '<small>od</small> ' : ''}${money(productPrice)}</strong><span class="pizza-size-note" aria-label="Průměr 30 nebo 40 centimetrů">⌀ 30 / 40 cm</span></div>
      <div class="pizza-card-actions"><button class="pizza-quick-add" data-quick-add="${item.id}" aria-label="Přidat ${escape(cleanName(item))}, 30 cm, do košíku">${icon('plus', 'icon-small')} Přidat do košíku</button><button class="pizza-edit" data-product="${item.id}" aria-label="Upravit ${escape(cleanName(item))}">Upravit <span>podle sebe</span> ${icon('arrow', 'icon-small')}</button></div></div></article>`;
    return `<article class="beverage-card" data-menu-product="${item.id}"><button class="beverage-photo" data-product="${item.id}" aria-label="Prohlédnout ${escape(cleanName(item))}">${item.image ? `<img src="./${escape(item.image)}" alt="${escape(cleanName(item))}" width="300" height="300" loading="lazy">` : icon('bag')}</button><div class="beverage-copy"><span class="beverage-category">${state.category === 'wine' ? 'Víno & prosecco' : 'Nápoje'}</span><h3>${escape(cleanName(item))}</h3><div class="beverage-bottom"><strong>${money(productPrice)}</strong><button class="beverage-add" data-quick-add="${item.id}" aria-label="Přidat ${escape(cleanName(item))} do košíku">${icon('plus', 'icon-small')} Přidat do košíku</button></div></div></article>`;
  }).join('') : `<div class="empty-menu">${icon('search')}<h3>TAHLE CHUŤ TU ZATÍM NENÍ</h3><p>Zkus jiný název nebo surovinu.</p><button class="button button-outline" data-reset-search>Zobrazit celou nabídku</button></div>`;
  $('#menu-results').textContent = `Nalezeno ${items.length} položek. Zobrazení: ${state.menuView === 'rows' ? 'řádky' : 'dlaždice'}.`;
  $('#drink-photo-credit').hidden = state.category !== 'drinks';
  $('#menu-note').textContent = { pizza: 'Každou pizzu pečeme ve velikosti 30 nebo 40 cm.', drinks: 'Něco na osvěžení k tvé oblíbené pizze.', wine: 'Víno a prosecco z nabídky vinařství Valdo.' }[state.category];
}

function activateCategory(category) {
  state.category = category;
  state.filter = 'all';
  state.query = '';
  $('#menu-search').value = '';
  $$('.category-tabs button').forEach(button => {
    const active = button.dataset.category === category;
    button.setAttribute('aria-selected', active);
    button.tabIndex = active ? 0 : -1;
  });
  $$('.filter-buttons button').forEach(button => button.setAttribute('aria-pressed', button.dataset.filter === 'all'));
  $('.filter-buttons').hidden = category !== 'pizza';
  $('#menu-panel').setAttribute('aria-labelledby', `tab-${category}`);
  renderMenu();
}

document.addEventListener('click', event => {
  const target = event.target.closest('button, a');
  if (!target) {
    const card = event.target.closest('[data-menu-product]');
    const interactive = event.target.closest('input, select, textarea, label, [role="button"], [contenteditable]');
    if (card && !interactive && window.getSelection()?.isCollapsed !== false) ordering?.openProduct(card.dataset.menuProduct, 30);
    return;
  }
  if (target.hasAttribute('data-close-dialog')) target.closest('dialog').close();
  if (target.hasAttribute('data-choose-branch')) openBranchDialog();
  if (target.hasAttribute('data-open-delivery')) openBranchDialog(true);
  if (target.dataset.selectBranch) openBranchDialog({ fulfillment: 'pickup', branchId: target.dataset.selectBranch });
  if (target.hasAttribute('data-cookie-settings')) privacyBanner?.open();
  if (target.dataset.category) activateCategory(target.dataset.category);
  if (['tiles', 'rows'].includes(target.dataset.menuView)) {
    state.menuView = target.dataset.menuView;
    $$('[data-menu-view]').forEach(button => button.setAttribute('aria-pressed', button.dataset.menuView === state.menuView));
    renderMenu();
  }
  if (target.dataset.quickAdd) { ordering?.quickAdd(target.dataset.quickAdd, 30); return; }
  if (target.dataset.filter) {
    state.filter = target.dataset.filter;
    $$('.filter-buttons button').forEach(button => button.setAttribute('aria-pressed', button === target));
    renderMenu();
  }
  if (target.dataset.product) ordering?.openProduct(target.dataset.product, 30);
  if (target.hasAttribute('data-reset-search')) {
    state.query = ''; state.filter = 'all'; $('#menu-search').value = '';
    $$('.filter-buttons button').forEach(button => button.setAttribute('aria-pressed', button.dataset.filter === 'all'));
    renderMenu(); $('#menu-search').focus();
  }
});

$('#menu-search').addEventListener('input', event => { state.query = event.target.value; renderMenu(); });
$('.category-tabs').addEventListener('keydown', event => {
  const tabs = $$('.category-tabs button');
  const index = tabs.indexOf(document.activeElement);
  if (index < 0) return;
  let next;
  if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
  if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
  if (event.key === 'Home') next = 0;
  if (event.key === 'End') next = tabs.length - 1;
  if (next !== undefined) { event.preventDefault(); activateCategory(tabs[next].dataset.category); tabs[next].focus(); }
});
$$('dialog').forEach(dialog => {
  dialog.addEventListener('click', event => {
    const rect = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
  });
  dialog.addEventListener('close', () => {
    if (!document.querySelector('dialog[open]')) document.body.classList.remove('modal-open');
  });
});

async function init() {
  try {
    const response = await fetch('./data/site.json');
    if (!response.ok) throw new Error('Menu unavailable');
    state.data = await response.json();
    state.branch = validBranch(state.data.branches, storageRead(storageKey));
    storageConsent = parseStorageConsent(storageRead(STORAGE_CONSENT_KEY));
    selection.branchId = state.branch?.id || null;
    ordering = createOrdering({
      data: state.data, openDialog, toast, showCartFeedback, getBranch: () => state.branch,
      setBranch: selectBranch, onDeliveryChange,
      editDelivery: () => openBranchDialog({ fulfillment: 'delivery' }),
      chooseBranch: afterBranch => { state.afterBranch = afterBranch; openBranchDialog(); }
    });
    deliveryChoice = createDeliveryDialog({
      data: state.data,
      getSelection: () => ({ ...ordering.getDeliverySelection(), remember: selection.remember }),
      onApply: applySelection,
      onClose: reason => {
        const resume = state.afterBranch;
        state.afterBranch = null;
        if (reason === 'applied') {
          if (resume) resume();
          else if (initialChoice) ordering.showSection('#menu');
        }
        initialChoice = false;
      },
    });
    privacyBanner = createPrivacyBanner({
      getPreferenceConsent: () => storageConsent,
      onDecision: mode => {
        setStorageConsent(mode);
        if (mode === 'essential') { selection.remember = false; ++preferenceVersion; forgetRememberedSelection(); }
        else void persistSelection();
      },
    });
    const rememberedRaw = storageRead(DELIVERY_PREFERENCE_KEY);
    const remembered = storageConsent === 'essential' ? null : parseRememberedSelection(rememberedRaw);
    if (rememberedRaw && !remembered) forgetRememberedSelection();
    let restored = false;
    if (remembered) {
      const restoreVersion = preferenceVersion;
      try {
        const addresses = remembered.fulfillment === 'delivery' ? await loadRuianAddresses() : null;
        const valid = canonicalSelection(remembered, state.data, addresses);
        if (valid) restored = await applySelection({ ...valid, remember: true }, { restoring: true, expectedVersion: restoreVersion });
        else forgetRememberedSelection();
      } catch { /* An unavailable address book leaves the initial choice editable. */ }
    }
    renderBranches(); renderMenu();
    ordering.initRoute();
    $('#copyright-year').textContent = new Date().getFullYear();
    if (!restored && $('#product-page').hidden && $('#checkout-page').hidden) openBranchDialog({ initial: true });
  } catch (error) {
    $('#menu-grid').innerHTML = '<div class="empty-menu"><h3>MENU SE TEĎ NEPODAŘILO NAČÍST</h3><p>Zkus stránku obnovit, nebo nám zavolej.<br>Rudná: <a href="tel:+420606918942">606 918 942</a> · Hostivice: <a href="tel:+420606518565">606 518 565</a> · Beroun: <a href="tel:+420737857493">737 857 493</a></p><button class="button" onclick="location.reload()">Zkusit znovu</button></div>';
    console.error('Pizza Visi: nepodařilo se načíst menu.', error);
  }
}

init();
