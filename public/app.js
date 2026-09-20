import { itemPrice, matchesItem, validBranch } from './menu-utils.js';
import { matchDeliveryBranch } from './delivery-demo.js';
import { createOrdering } from './ordering.js';

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const icon = (name, extra = '') => `<svg class="icon ${extra}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const money = value => `${new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 }).format(value)} Kč`;
const cleanName = item => item.name.replace(/^\d+\.\s*/, '').replace(/\s*🌶️?/gu, '').trim();
const branchDialog = $('#branch-dialog');
const storageKey = 'pizza-visi-branch-v1';
const state = { data: null, branch: null, category: 'pizza', filter: 'all', size: 30, query: '', expanded: false, afterBranch: null };
let ordering;
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

function openBranchDialog(focusAddress = false) {
  if (!state.data) return;
  renderBranchOptions();
  $('#delivery-address-form').reset();
  clearAddressResult();
  openDialog(branchDialog);
  if (focusAddress) $('#delivery-address').focus();
}

function clearAddressResult() {
  $('#address-feedback').textContent = '';
  $('#delivery-address').removeAttribute('aria-invalid');
}

function findDeliveryBranch() {
  if (!state.data) return;
  clearAddressResult();
  const result = matchDeliveryBranch($('#delivery-address').value, state.data.branches);
  if (result.status === 'matched') {
    const branch = validBranch(state.data.branches, result.branchIds[0]);
    ordering?.setAddress($('#delivery-address').value);
    selectBranch(branch.id);
    toast(`Podle adresy jsme vybrali pobočku ${branch.name}.`);
    return;
  }
  $('#address-feedback').textContent = result.status === 'empty'
    ? 'Doplň prosím město nebo obec.'
    : result.status === 'ambiguous'
      ? 'Tuto lokalitu obsluhuje více poboček. Vyber si jednu nahoře.'
      : 'Tuhle lokalitu v demu nepoznáme. Doplň město, nebo vyber pobočku nahoře.';
  $('#delivery-address').setAttribute('aria-invalid', 'true');
}

function branchCard(branch, modal = false) {
  const selected = state.branch?.id === branch.id;
  const street = branch.address.replace(/, (Rudná \(u Prahy\)|Hostivice|Beroun)$/, '');
  if (modal) return `<button class="branch-option ${selected ? 'selected' : ''}" data-select-branch="${branch.id}" aria-label="Vybrat pobočku ${escape(branch.name)}" aria-pressed="${selected}"><span class="branch-option-image"><img src="./${branch.image}" width="640" height="380" alt="Pizzerie Pizza Visi ${escape(branch.name)}">${selected ? `<span class="branch-selected-mark">${icon('check', 'icon-small')}<span>Vybráno</span></span>` : ''}</span><span class="branch-option-content"><span class="branch-option-title"><span class="branch-name">${escape(branch.name)}</span>${icon('arrow', 'icon-small')}</span><span class="branch-street">${escape(street)}</span></span></button>`;
  return `<article class="branch-card ${selected ? 'selected' : ''}"><div class="branch-card-image"><img src="./${branch.image}" width="640" height="380" loading="lazy" alt="Pizzerie Pizza Visi ${escape(branch.name)}">${selected ? '<span class="selected-tag">Tvoje pobočka</span>' : ''}</div><div class="branch-card-content"><div class="branch-card-heading"><h3>${escape(branch.name)}</h3><span>0${state.data.branches.indexOf(branch) + 1}</span></div><p>${escape(street)}</p><span class="branch-hours">${icon('clock', 'icon-small')} Po–So · 11:00–21:00</span><a class="branch-phone" href="${branch.phone_uri}">${icon('phone', 'icon-small')} ${branch.phone}</a><button class="branch-card-select" data-select-branch="${branch.id}">${selected ? 'Vybraná pobočka' : 'Vybrat tuto pobočku'} ${icon(selected ? 'check' : 'arrow')}</button></div></article>`;
}

function renderBranchOptions() { $('#branch-options').innerHTML = state.data.branches.map(branch => branchCard(branch, true)).join(''); }

function renderBranches() {
  $('#header-branch').textContent = state.branch?.name || 'Vybrat pobočku';
  $('.branch-switch').setAttribute('aria-label', state.branch ? `Změnit pobočku: ${state.branch.name}` : 'Vybrat pobočku');
  $('#branches-grid').innerHTML = state.data.branches.map(branch => branchCard(branch)).join('');
  renderBranchOptions();
  renderDelivery();
  renderHero();
}

function renderHero() {
  const branch = state.branch;
  const photo = branch || state.data.branches[0];
  $('#hero-branch-image').src = `./${photo.image}`;
  $('#hero-location-label').textContent = branch ? 'Tvoje pobočka. Tvoje oblíbená pizza.' : 'Tři místa. Jedna láska k pizze.';
  $('#hero-location-name').textContent = branch?.name || 'Rudná · Hostivice · Beroun';
  $('#hero-location-address').textContent = branch?.address || 'Vyber si svoji pobočku';
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
  try { localStorage.setItem(storageKey, branch.id); } catch { /* Selection still works with storage disabled. */ }
  const afterBranch = state.afterBranch;
  state.afterBranch = null;
  renderBranches();
  branchDialog.close();
  toast(`Pobočka ${branch.name} je tvoje. Dobrou chuť!`);
  ordering?.branchChanged();
  if (afterBranch) afterBranch();
}

function categoryItems() {
  const categories = state.data.categories;
  const ids = { pizza: ['pizzy'], extras: ['dej-si-navic', 'chutne-okraje', 'omacky', 'baleni'], drinks: ['napoje'], wine: ['vino-prosecco'] }[state.category];
  return categories.filter(category => ids.includes(category.id)).flatMap(category => category.items.map(item => ({ ...item, categoryName: category.name })));
}

function renderMenu() {
  if (!state.data) return;
  const items = categoryItems().filter(item => matchesItem(item, state.query, state.category === 'pizza' ? state.filter : 'all'));
  const limit = state.category === 'pizza' ? 6 : 12;
  const visible = state.expanded ? items : items.slice(0, limit);
  const grid = $('#menu-grid');
  grid.classList.toggle('compact-grid', state.category === 'extras' || state.category === 'drinks');
  grid.classList.toggle('wine-grid', state.category === 'wine');
  grid.innerHTML = visible.length ? visible.map(item => {
    const spicy = item.name.includes('🌶');
    const productPrice = itemPrice(item, state.size);
    if (!item.image) return `<article class="compact-item"><div><span class="compact-category">${escape(item.categoryName)}</span><h3>${escape(cleanName(item))}</h3>${item.prices.length ? `<span class="compact-size">K pizze ${state.size} cm</span>` : ''}</div><div class="compact-item-action"><strong>${money(productPrice)}</strong><button class="icon-button" data-product="${item.id}" aria-label="Detail: ${escape(cleanName(item))}">${icon('arrow')}</button></div></article>`;
    return `<article class="pizza-card"><button class="pizza-image-button" data-product="${item.id}" aria-label="Prohlédnout ${escape(cleanName(item))}"><span class="pizza-number">${item.number ? String(item.number).padStart(2, '0') : 'VISI / VÍNO'}</span>${spicy ? `<span class="spicy-tag">${icon('fire', 'icon-small')} Pálivá</span>` : ''}<img src="./${item.image}" alt="${escape(cleanName(item))}" width="600" height="600" loading="lazy"></button><div class="pizza-card-copy"><h3>${escape(cleanName(item))}</h3><p>${escape(item.description || 'K dobré pizze patří dobré víno.')}</p><div class="pizza-card-bottom"><div><strong>${money(productPrice)}</strong>${item.prices.length ? `<span>/ ${state.size} cm</span>` : ''}</div><button class="pizza-select" data-product="${item.id}" aria-label="Vybrat ${escape(cleanName(item))}">Vybrat ${icon('arrow', 'icon-small')}</button></div></div></article>`;
  }).join('') : `<div class="empty-menu">${icon('search')}<h3>TAHLE CHUŤ TU ZATÍM NENÍ.</h3><p>Zkus jiný název nebo surovinu.</p><button class="button button-outline" data-reset-search>Zobrazit celou nabídku</button></div>`;
  $('#menu-results').textContent = `Nalezeno ${items.length} položek, zobrazeno ${visible.length}.`;
  $('#show-more').hidden = state.expanded || items.length <= limit;
  $('#show-more').innerHTML = `Prohlédnout ${state.category === 'pizza' && items.length === 24 ? 'všech 24 pizz' : `všechny položky (${items.length})`} ${icon('arrow')}`;
  $('#menu-note').textContent = { pizza: 'Každou pizzu pečeme ve velikosti 30 nebo 40 cm.', extras: `Přísady a okraje podle tvé chuti. Ceny pro pizzu ${state.size} cm.`, drinks: 'Něco na osvěžení k tvé oblíbené pizze.', wine: 'Víno a prosecco z nabídky vinařství Valdo.' }[state.category];
}

function activateCategory(category) {
  state.category = category;
  state.expanded = false;
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
  $('.size-toggle').hidden = !['pizza', 'extras'].includes(category);
  $('#menu-panel').setAttribute('aria-labelledby', `tab-${category}`);
  renderMenu();
}

document.addEventListener('click', event => {
  const target = event.target.closest('button, a');
  if (!target) return;
  if (target.hasAttribute('data-close-dialog')) target.closest('dialog').close();
  if (target.hasAttribute('data-choose-branch')) openBranchDialog();
  if (target.hasAttribute('data-open-delivery')) openBranchDialog(true);
  if (target.dataset.selectBranch) selectBranch(target.dataset.selectBranch);
  if (target.dataset.category) activateCategory(target.dataset.category);
  if (target.dataset.size) {
    state.size = Number(target.dataset.size);
    $$('.size-toggle button').forEach(button => button.setAttribute('aria-pressed', button === target));
    renderMenu();
  }
  if (target.dataset.filter) {
    state.filter = target.dataset.filter; state.expanded = false;
    $$('.filter-buttons button').forEach(button => button.setAttribute('aria-pressed', button === target));
    renderMenu();
  }
  if (target.id === 'show-more') { state.expanded = true; renderMenu(); }
  if (target.dataset.product) ordering?.openProduct(target.dataset.product, state.size);
  if (target.hasAttribute('data-reset-search')) {
    state.query = ''; state.filter = 'all'; state.expanded = false; $('#menu-search').value = '';
    $$('.filter-buttons button').forEach(button => button.setAttribute('aria-pressed', button.dataset.filter === 'all'));
    renderMenu(); $('#menu-search').focus();
  }
  if (target.closest('#mobile-nav')) {
    $('#mobile-nav').hidden = true; $('.mobile-nav-toggle').setAttribute('aria-expanded', 'false');
  }
});

$('#menu-search').addEventListener('input', event => { state.query = event.target.value; state.expanded = false; renderMenu(); });
$('#delivery-address-form').addEventListener('submit', event => { event.preventDefault(); findDeliveryBranch(); });
$('#delivery-address').addEventListener('input', clearAddressResult);
$('.mobile-nav-toggle').addEventListener('click', event => {
  const open = $('#mobile-nav').hidden;
  $('#mobile-nav').hidden = !open;
  event.currentTarget.setAttribute('aria-expanded', String(open));
  event.currentTarget.setAttribute('aria-label', open ? 'Zavřít navigaci' : 'Otevřít navigaci');
});
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
    if (dialog === branchDialog) state.afterBranch = null;
  });
});

async function init() {
  try {
    const response = await fetch('./data/site.json');
    if (!response.ok) throw new Error('Menu unavailable');
    state.data = await response.json();
    let saved;
    try { saved = localStorage.getItem(storageKey); } catch { /* Storage is optional. */ }
    state.branch = validBranch(state.data.branches, saved);
    ordering = createOrdering({
      data: state.data, openDialog, toast, getBranch: () => state.branch,
      setBranch: selectBranch,
      chooseBranch: afterBranch => { state.afterBranch = afterBranch; openBranchDialog(); }
    });
    renderBranches(); renderMenu();
    $('#copyright-year').textContent = new Date().getFullYear();
    if (!state.branch) openBranchDialog();
  } catch (error) {
    $('#menu-grid').innerHTML = '<div class="empty-menu"><h3>MENU SE TEĎ NEPODAŘILO NAČÍST.</h3><p>Zkus stránku obnovit, nebo nám zavolej.<br>Rudná: <a href="tel:+420606918942">606 918 942</a> · Hostivice: <a href="tel:+420606518565">606 518 565</a> · Beroun: <a href="tel:+420737857493">737 857 493</a></p><button class="button" onclick="location.reload()">Zkusit znovu</button></div>';
    $('#show-more').hidden = true;
    console.error('Pizza Visi: nepodařilo se načíst menu.', error);
  }
}

init();
