import { createHeroCarousel } from './hero-carousel.js?v=2';
import { itemPrice, matchesItem, validBranch } from './menu-utils.js';
import { createPrivacyBanner } from './privacy-banner.js';
import { loadRuianAddresses } from './ruian-addresses.js';
import { DELIVERY_PREFERENCE_KEY, STORAGE_CONSENT_KEY, parseRememberedSelection, canonicalSelection, serializeRememberedSelection, parseStorageConsent } from './delivery-preferences.js';
import { createOrdering } from './ordering.js?v=config-layout-1';
import { showCartFeedback } from './cart-feedback.js?v=half-pizza-1';

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const icon = (name, extra = '') => `<svg class="icon ${extra}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const money = value => `${new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 }).format(value)} Kč`;
const cleanName = item => item.name.replace(/^\d+\.\s*/, '').replace(/\s*🌶️?/gu, '').trim();
const state = { data: null, branch: null, category: 'pizza', filter: 'all', menuView: 'tiles' };
let ordering;
let privacyBanner;
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
  if (!current.remember || !current.branchId || (current.fulfillment === 'delivery' && !current.addressId)) { forgetRememberedSelection(); return; }
  try {
    const addresses = current.fulfillment === 'delivery' ? await loadRuianAddresses() : null;
    if (version !== preferenceVersion) return;
    const raw = serializeRememberedSelection(current, state.data, addresses);
    if (!storageWrite(DELIVERY_PREFERENCE_KEY, raw)) toast('Výběr platí pro tuto návštěvu. Prohlížeč jeho uložení nepovolil.');
  } catch { if (version === preferenceVersion) forgetRememberedSelection(); }
}
function onDeliveryChange(value) {
  selection = { ...value, remember: selection.remember };
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

function branchCard(branch) {
  const selected = state.branch?.id === branch.id;
  const street = branch.address.replace(/, (Rudná \(u Prahy\)|Hostivice|Beroun)$/, '');
  return `<article id="pobocka-${branch.id}" class="branch-card ${selected ? 'selected' : ''}"><div class="branch-card-image"><img src="./${branch.image}" width="640" height="380" loading="lazy" alt="Pizzerie Pizza Visi ${escape(branch.name)}">${selected ? '<span class="selected-tag">Tvoje pobočka</span>' : ''}</div><div class="branch-card-content"><div class="branch-card-heading"><h3>${escape(branch.name)}</h3><span>0${state.data.branches.indexOf(branch) + 1}</span></div><p>${escape(street)}</p><span class="branch-hours">${icon('clock', 'icon-small')} Po–So · 11:00–21:00</span><a class="branch-phone" href="${branch.phone_uri}">${icon('phone', 'icon-small')} ${branch.phone}</a><a class="branch-card-select" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('Pizza Visi ' + branch.address)}" target="_blank" rel="noopener noreferrer">Najít na mapě ${icon('external')}</a></div></article>`;
}

function renderBranches() {
  $('#branches-grid').innerHTML = state.data.branches.map(branch => branchCard(branch)).join('');
  renderDelivery();
}

function renderDelivery() {
  $('#delivery-card').innerHTML = `<div class="delivery-empty"><div class="delivery-drawing">${icon('truck')}</div><p class="eyebrow">Rudná · Hostivice · Beroun</p><h3>ADRESU ZADÁŠ<br><em>V OBJEDNÁVCE</em></h3><p>Podle místa doručení vybereme pobočku.<br>Pro osobní vyzvednutí si ji zvolíš sám.</p><a class="button button-outline" href="#menu">Vybrat si pizzu ${icon('arrow')}</a></div>`;
}

function selectBranch(id) {
  if ((state.branch?.id || null) === (id || null)) return;
  state.branch = validBranch(state.data.branches, id) || null;
  renderBranches();
}

function categoryItems() {
  const categories = state.data.categories;
  const ids = { pizza: ['pizzy'], drinks: ['napoje'], wine: ['vino-prosecco'] }[state.category];
  return categories.filter(category => ids.includes(category.id)).flatMap(category => category.items.map(item => ({ ...item, categoryName: category.name })));
}

function renderMenu() {
  if (!state.data) return;
  const items = categoryItems().filter(item => matchesItem(item, '', state.category === 'pizza' ? state.filter : 'all'));
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
      <div class="pizza-card-bottom"><strong class="pizza-card-price">${itemPrice(item, 40) > productPrice ? '<small>od</small> ' : ''}${money(productPrice)}</strong><span class="pizza-size-note" aria-label="Průměr 30 nebo 40 centimetrů">${icon('diameter', 'icon-small')} 30 / 40 cm</span></div>
      <div class="pizza-card-actions"><button class="pizza-quick-add" data-quick-add="${item.id}" aria-label="Přidat ${escape(cleanName(item))}, 30 cm, do košíku">${icon('plus', 'icon-small')} Přidat do košíku</button><button class="pizza-edit" data-product="${item.id}" aria-label="Upravit ${escape(cleanName(item))}">Upravit <span>podle sebe</span> ${icon('arrow', 'icon-small')}</button></div></div></article>`;
    return `<article class="beverage-card" data-menu-product="${item.id}"><button class="beverage-photo" data-product="${item.id}" aria-label="Prohlédnout ${escape(cleanName(item))}">${item.image ? `<img src="./${escape(item.image)}" alt="${escape(cleanName(item))}" width="300" height="300" loading="lazy">` : icon('bag')}</button><div class="beverage-copy"><span class="beverage-category">${state.category === 'wine' ? 'Víno & prosecco' : 'Nápoje'}</span><h3>${escape(cleanName(item))}</h3><div class="beverage-bottom"><strong>${money(productPrice)}</strong><button class="beverage-add" data-quick-add="${item.id}" aria-label="Přidat ${escape(cleanName(item))} do košíku">${icon('plus', 'icon-small')} Přidat do košíku</button></div></div></article>`;
  }).join('') : `<div class="empty-menu">${icon('search')}<h3>TAHLE CHUŤ TU ZATÍM NENÍ</h3><p>Zkus jiný filtr.</p><button class="button button-outline" data-reset-filters>Zobrazit celou nabídku</button></div>`;
  $('#menu-results').textContent = `Nalezeno ${items.length} položek. Zobrazení: ${state.menuView === 'rows' ? 'řádky' : 'dlaždice'}.`;
  $('#menu-note').textContent = { pizza: 'Každou pizzu pečeme ve velikosti 30 nebo 40 cm.', drinks: 'Něco na osvěžení k tvé oblíbené pizze.', wine: 'Víno a prosecco z nabídky vinařství Valdo.' }[state.category];
}

function activateCategory(category) {
  state.category = category;
  state.filter = 'all';
  $$('.category-tabs button').forEach(button => {
    const active = button.dataset.category === category;
    button.setAttribute('aria-selected', active);
    button.tabIndex = active ? 0 : -1;
  });
  $$('.filter-buttons button').forEach(button => button.setAttribute('aria-pressed', button.dataset.filter === 'all'));
  $('.filter-buttons').hidden = category !== 'pizza';
  $('#menu-panel').setAttribute('aria-labelledby', `tab-${category}`);
  renderMenu();
  revealMenuStart();
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
  if (target.hasAttribute('data-cookie-settings')) privacyBanner?.open();
  if (target.dataset.category) activateCategory(target.dataset.category);
  if (['tiles', 'rows'].includes(target.dataset.menuView)) {
    state.menuView = target.dataset.menuView;
    $$('[data-menu-view]').forEach(button => button.setAttribute('aria-pressed', button.dataset.menuView === state.menuView));
    renderMenu(); revealMenuStart();
  }
  if (target.dataset.quickAdd) { ordering?.quickAdd(target.dataset.quickAdd, 30); return; }
  if (target.dataset.filter) {
    state.filter = target.dataset.filter;
    $$('.filter-buttons button').forEach(button => button.setAttribute('aria-pressed', button === target));
    renderMenu(); revealMenuStart();
  }
  if (target.dataset.product) ordering?.openProduct(target.dataset.product, 30);
  if (target.hasAttribute('data-reset-filters')) {
    state.filter = 'all';
    $$('.filter-buttons button').forEach(button => button.setAttribute('aria-pressed', button.dataset.filter === 'all'));
    renderMenu(); $('[data-filter="all"]').focus();
  }
});

function revealMenuStart() {
  const controls = $('.menu-controls');
  const headerHeight = $('.site-header').getBoundingClientRect().height;
  if (controls.getBoundingClientRect().top <= headerHeight + 8) {
    requestAnimationFrame(() => {
      const top = window.scrollY + $('#menu-panel').getBoundingClientRect().top - headerHeight - controls.getBoundingClientRect().height - 18;
      window.scrollTo({ top, behavior: 'instant' });
    });
  }
}
const measureMenuControls = () => {
  document.documentElement.style.setProperty('--site-header-height', `${$('.site-header').getBoundingClientRect().height}px`);
  document.documentElement.style.setProperty('--menu-controls-height', `${$('.menu-controls').getBoundingClientRect().height}px`);
};
const menuSizing = new ResizeObserver(measureMenuControls);
menuSizing.observe($('.site-header'));
menuSizing.observe($('.menu-controls'));
measureMenuControls();

const siteHeader = $('.site-header');
let headerFrame = null;
function syncCompactHeader() {
  headerFrame = null;
  if (window.scrollY > 96) siteHeader.classList.add('is-compact');
  else if (window.scrollY < 24) siteHeader.classList.remove('is-compact');
}
window.addEventListener('scroll', () => {
  if (headerFrame === null) headerFrame = requestAnimationFrame(syncCompactHeader);
}, { passive: true });
syncCompactHeader();

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
    const response = await fetch('./data/site.json?v=webp-1');
    if (!response.ok) throw new Error('Menu unavailable');
    state.data = await response.json();
    createHeroCarousel({ branches: state.data.branches, icon, escape });
    storageConsent = parseStorageConsent(storageRead(STORAGE_CONSENT_KEY));
    ordering = createOrdering({
      data: state.data, openDialog, toast, showCartFeedback, getBranch: () => state.branch,
      setBranch: selectBranch, onDeliveryChange,
      getRememberPreference: () => selection.remember,
      onRememberChange: remember => {
        selection.remember = remember;
        if (remember && storageConsent === 'essential') setStorageConsent('accepted');
        void persistSelection();
      },
    });
    privacyBanner = createPrivacyBanner({
      getPreferenceConsent: () => storageConsent,
      onDecision: mode => {
        setStorageConsent(mode);
        if (mode === 'essential') { selection.remember = false; ++preferenceVersion; forgetRememberedSelection(); ordering.syncRememberPreference(); }
        else void persistSelection();
      },
    });
    const rememberedRaw = storageRead(DELIVERY_PREFERENCE_KEY);
    const remembered = storageConsent === 'essential' ? null : parseRememberedSelection(rememberedRaw);
    if (rememberedRaw && !remembered) forgetRememberedSelection();
    if (remembered) {
      const restoreVersion = preferenceVersion;
      try {
        const addresses = remembered.fulfillment === 'delivery' ? await loadRuianAddresses() : null;
        const valid = canonicalSelection(remembered, state.data, addresses);
        if (valid) await applySelection({ ...valid, remember: true }, { restoring: true, expectedVersion: restoreVersion });
        else forgetRememberedSelection();
      } catch { /* An unavailable address book leaves checkout editable. */ }
    }
    renderBranches(); renderMenu();
    ordering.initRoute();
    $('#copyright-year').textContent = new Date().getFullYear();
  } catch (error) {
    $('#menu-grid').innerHTML = '<div class="empty-menu"><h3>MENU SE TEĎ NEPODAŘILO NAČÍST</h3><p>Zkus stránku obnovit, nebo nám zavolej.<br>Rudná: <a href="tel:+420606918942">606 918 942</a> · Hostivice: <a href="tel:+420606518565">606 518 565</a> · Beroun: <a href="tel:+420737857493">737 857 493</a></p><button class="button" onclick="location.reload()">Zkusit znovu</button></div>';
    console.error('Pizza Visi: nepodařilo se načíst menu.', error);
  }
}

init();
