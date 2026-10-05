import { itemPrice, normalizeSearch } from './menu-utils.js';
import { MAX_QUANTITY, getItem, normalizeLine, mergeLine, unitPrice, cartTotals, restoreCart, serializeCart, basePrice, lineName, lineDetails, cloneLine } from './cart-model.js?v=combined-removals-1';
import { PRODUCT_CATEGORIES, productHash, parseProductRoute, editSnapshot, findEditingLine } from './product-route.js?v=combined-removals-1';
import { loadRuianAddresses, searchAddresses, resolveAddress } from './ruian-addresses.js';
import { submitLocalOrder } from './storefront-orders.js?v=combined-removals-1';
import { mountPickupMap } from './pickup-map.js';
import { bindAddressSuggestionEvents } from './address-suggestion-events.js';
import { PIZZA_BASES, recipeBase, removableIngredients, customizationFields, removalChoices, setIngredientRemoval } from './pizza-customization.js?v=combined-removals-1';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const money = value => `${new Intl.NumberFormat('cs-CZ').format(value)} Kč`;
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const name = item => item.name.replace(/^\d+\.\s*/, '').replace(/\s*🌶️?/gu, '').trim();
const CART_KEY = 'pizza-visi-demo-cart-v1';
const closeButton = label => `<button class="icon-button dialog-close" data-close-dialog aria-label="${label}">${icon('close')}</button>`;
const stepper = (quantity, scope, label) => `<div class="quantity-stepper" role="group" aria-label="Počet: ${esc(label)}"><button data-quantity="${scope}" data-delta="-1" aria-label="Ubrat kus: ${esc(label)}" ${quantity <= 1 ? 'disabled' : ''}>${icon('minus')}</button><span aria-live="polite">${quantity}</span><button data-quantity="${scope}" data-delta="1" aria-label="Přidat kus: ${esc(label)}" ${quantity >= MAX_QUANTITY ? 'disabled' : ''}>${icon('plus')}</button></div>`;

export function createOrdering(context) {
  const { data, openDialog, toast, showCartFeedback, getBranch, setBranch, onDeliveryChange, getRememberPreference, onRememberChange } = context;
  const productPage = $('#product-page');
  const storefront = $('#storefront');
  const siteFooter = $('#site-footer');
  const cartDialog = $('#cart-dialog');
  const halfPicker = $('#half-picker-dialog');
  const checkoutPage = $('#checkout-page');
  let cart = [];
  try { cart = restoreCart(data, localStorage.getItem(CART_KEY)); } catch { /* Storage is optional. */ }
  let fulfillment = 'delivery';
  let draft = null;
  const productSessions = new Map();
  const pageTitle = document.title;
  let productSession = null;
  let activeProductHash = '';
  let routeReady = false;
  let receipt = null;
  let checkoutReturn = null;
  let addressBook = null;
  let addressLoading = false;
  let addressLoadError = false;
  let addressResults = [];
  let addressActive = -1;
  let selectedAddressId = null;
  let deliverySelectionVersion = 0;
  let submitting = false;
  let submissionKey = null;
  const customer = { name: '', phone: '', email: '', address: '', note: '', payment: 'cash' };

  function saveCart() {
    submissionKey = null;
    try { localStorage.setItem(CART_KEY, serializeCart(cart)); } catch { /* Still usable without storage. */ }
    updateBadge();
  }
  function totals() { return cartTotals(data, cart, fulfillment); }
  function updateBadge() {
    const total = totals();
    $('#cart-count').textContent = total.quantity;
    $('.cart-trigger').setAttribute('aria-label', `Otevřít košík, ${total.quantity} položek`);
    $('.mobile-cart').hidden = !cart.length;
    document.body.classList.toggle('has-cart', Boolean(cart.length));
    $('#mobile-cart-label').textContent = `Košík · ${total.quantity} ks`;
    $('#mobile-cart-total').textContent = money(total.total);
  }
  function getDeliverySelection() {
    return { fulfillment, branchId: getBranch()?.id, addressId: selectedAddressId, address: customer.address };
  }
  async function applyDeliverySelection(selection) {
    if (submitting) return false;
    if (!selection || !['delivery', 'pickup'].includes(selection.fulfillment)) throw new Error('Neplatný způsob převzetí.');
    const version = ++deliverySelectionVersion;
    captureCustomer();
    let canonical = null;
    let nextBook = addressBook;
    if (selection.fulfillment === 'delivery') {
      nextBook ||= await loadRuianAddresses();
      if (submitting || version !== deliverySelectionVersion) return false;
      canonical = resolveAddress(nextBook, selection.addressId);
      if (!canonical) throw new Error('Vyber platnou adresu z registru RÚIAN.');
      if (!canonical.branchIds.includes(selection.branchId || getBranch()?.id)) throw new Error('Vybraná pobočka na tuto adresu nerozváží.');
    }
    if (submitting || version !== deliverySelectionVersion || (selection.branchId && selection.branchId !== getBranch()?.id)) return false;
    // Capture edits made while the address data loaded before refreshing the form.
    captureCustomer();
    fulfillment = selection.fulfillment;
    selectedAddressId = canonical?.id || null;
    customer.address = canonical?.label || '';
    if (nextBook) { addressBook = nextBook; addressLoadError = false; }
    updateBadge();
    if (!checkoutPage.hidden && !receipt) renderCheckout();
    if (cartDialog.open) renderCart();
    return true;
  }
  function setAddress(value) {
    if (submitting) return;
    ++deliverySelectionVersion;
    setBranch(null);
    customer.address = value; selectedAddressId = null; fulfillment = 'delivery'; updateBadge();
  }
  function menuReturn() {
    return { hash: parseProductRoute(location.hash, data) || location.hash === '#objednavka' ? '#menu' : location.hash, scroll: window.scrollY, focus: document.activeElement };
  }
  function routeState(key) { return { ...(history.state || {}), pizzaProductEntry: key }; }
  function clearRouteState() {
    const next = { ...(history.state || {}) };
    delete next.pizzaProductEntry;
    return next;
  }
  function revealStorefront({ section = false, restoreFocus = true } = {}) {
    const previous = productSession || (!checkoutPage.hidden && checkoutReturn ? { returnTo: checkoutReturn } : null);
    productPage.hidden = true;
    checkoutPage.hidden = true;
    storefront.hidden = false;
    siteFooter.hidden = false;
    document.body.classList.remove('product-open', 'checkout-open');
    document.title = pageTitle;
    draft = null;
    productSession = null;
    activeProductHash = '';
    if (!previous && !section) return;
    requestAnimationFrame(() => {
      if (!productPage.hidden || !checkoutPage.hidden) return;
      if (!section && previous && previous.returnTo.scroll !== null && location.hash === previous.returnTo.hash) {
        window.scrollTo({ top: previous.returnTo.scroll, behavior: 'instant' });
      } else {
        let target;
        try { target = document.getElementById(decodeURIComponent(location.hash.slice(1))); } catch { /* Invalid anchor returns to the top. */ }
        if (target) target.scrollIntoView({ behavior: 'instant' });
        else window.scrollTo({ top: 0, behavior: 'instant' });
      }
      if (restoreFocus && previous && !document.querySelector('dialog[open]')) {
        const origin = previous.returnTo.focus;
        if (origin?.isConnected && !origin.closest('[hidden]') && !origin.closest('dialog:not([open])')) origin.focus({ preventScroll: true });
        else $('.cart-trigger').focus({ preventScroll: true });
      }
    });
  }
  function syncProductRoute(options = {}) {
    if (halfPicker.open) halfPicker.close();
    if (location.hash === '#objednavka') { showCheckoutPage(); return; }
    const route = parseProductRoute(location.hash, data);
    if (route?.invalid) {
      history.replaceState(clearRouteState(), '', '#menu');
      revealStorefront({ section: true });
      toast('Tuhle položku v menu nenajdeme. Vyber si prosím jinou.');
      return;
    }
    if (!route) { revealStorefront(options); return; }
    const stateKey = history.state?.pizzaProductEntry;
    if (!productPage.hidden && activeProductHash === location.hash && productSession?.key === stateKey) return;
    let session = productSessions.get(stateKey);
    if (!session || session.draft.itemId !== route.itemId) {
      const key = crypto.randomUUID();
      session = { key, draft: normalizeLine(data, { itemId: route.itemId, size: route.size, quantity: 1 }), snapshot: null, backable: false, returnTo: { hash: '#menu', scroll: null, focus: null } };
      productSessions.set(key, session);
      history.replaceState(routeState(key), '', productHash(route.itemId, route.size));
    }
    session.draft.size = normalizeLine(data, { ...session.draft, size: route.size }).size;
    productSession = session;
    draft = session.draft;
    activeProductHash = location.hash;
    storefront.hidden = true;
    siteFooter.hidden = true;
    checkoutPage.hidden = true;
    productPage.hidden = false;
    document.body.classList.remove('checkout-open');
    document.body.classList.add('product-open');
    document.title = `${name(getItem(data, draft.itemId))} – upravit | Pizza Visi`;
    renderProduct();
    window.scrollTo({ top: 0, behavior: 'instant' });
    productPage.focus({ preventScroll: true });
  }
  function leaveProduct({ back = false, restoreFocus = true } = {}) {
    if (!productSession) return;
    if (back && productSession.backable) { history.back(); return; }
    history.replaceState(clearRouteState(), '', `${location.pathname}${location.search}${productSession.returnTo.hash}`);
    revealStorefront({ restoreFocus });
  }
  function showSection(hash = '#menu') {
    const targetHash = hash.startsWith('#') ? hash : '#menu';
    history.pushState(clearRouteState(), '', targetHash);
    revealStorefront({ section: true, restoreFocus: false });
  }
  function openProduct(id, index = -1, size = 30) {
    if (submitting) return;
    const item = getItem(data, id);
    if (!item) return;
    if (item.categoryId === 'baleni') { toast('Krabice se do košíku připočítá automaticky ke každé pizze.'); return; }
    if (!PRODUCT_CATEGORIES.includes(item.categoryId)) { toast('Přísady vyber u konkrétní pizzy.'); return; }
    const editing = index >= 0 ? cart[index] : null;
    if (index >= 0 && (!editing || editing.itemId !== id)) return;
    const key = crypto.randomUUID();
    const session = { key, draft: normalizeLine(data, editing || { itemId: id, size, quantity: 1, extras: [] }), snapshot: editSnapshot(editing), backable: productSession ? productSession.backable : true, returnTo: productSession?.returnTo || menuReturn() };
    productSessions.set(key, session);
    const method = productSession ? 'replaceState' : 'pushState';
    history[method](routeState(key), '', productHash(id, session.draft.size));
    cartDialog.close();
    captureCustomer();
    syncProductRoute();
  }
  function quickAdd(id, size = 30) {
    if (submitting) return;
    const item = getItem(data, id);
    if (!item || !PRODUCT_CATEGORIES.includes(item.categoryId)) { toast('Přísady vyber u konkrétní pizzy.'); return; }
    const line = normalizeLine(data, { itemId: id, size, quantity: 1 });
    if (!line) return;
    cart = mergeLine(cart, line);
    saveCart();
    if (cartDialog.open) renderCart();
    showCartFeedback?.({ name: name(item), image: item.image || null, size: line.size, quantity: line.quantity, updated: false });
  }
  function productPhoto(line, className = 'product-page-photo') {
    const item = getItem(data, line.itemId);
    if (!item.image) return '';
    const second = line.halves && getItem(data, line.halves[1].itemId);
    return `<figure class="${className}${second ? ' pizza-composite' : ''}" role="img" aria-label="${esc(lineName(data, line))}"><img class="product-photo ${item.categoryId === 'pizzy' ? 'product-photo-pizza' : ''}" src="./${esc(item.image)}" alt="">${second ? `<img class="product-photo-pizza" src="./${esc(second.image)}" alt="">` : ''}</figure>`;
  }
  function addonOptions(categoryId, half = null) {
    const extras = half === null ? draft.extras : draft.halves[half].extras;
    return (data.categories.find(c => c.id === categoryId)?.items || []).map(item => `<label class="addon-option"><input type="checkbox" data-addon="${item.id}" ${half === null ? '' : `data-half="${half}"`} ${extras.includes(item.id) ? 'checked' : ''}><span>${esc(name(item))}</span><strong data-addon-price="${item.id}">+${money(itemPrice(item, draft.size))}</strong></label>`).join('');
  }
  function halfChoices() {
    if (!draft.halves) return '';
    const second = getItem(data, draft.halves[1].itemId);
    return `<div class="half-choice"><button type="button" class="half-choice-trigger" data-open-half-picker aria-haspopup="dialog" aria-controls="half-picker-dialog" aria-label="Změnit druhou půlku, ${esc(name(second))}"><img src="./${esc(second.image)}" alt=""><span class="half-choice-copy"><span>Druhá půlka</span><strong>${esc(name(second))}</strong><small>${esc(second.description)}</small></span><span class="half-choice-action"><b data-second-half-price>${money(itemPrice(second, draft.size))}</b><span>Změnit ${icon('chev')}</span></span></button></div>`;
  }
  function renderHalfPickerItems(query = '') {
    const search = normalizeSearch(query.trim());
    const pizzas = data.categories.find(c => c.id === 'pizzy').items.filter(item => normalizeSearch(name(item) + ' ' + item.description).includes(search));
    $('#half-picker-results', halfPicker).innerHTML = pizzas.map(item => {
      const selected = item.id === draft.halves[1].itemId;
      return `<button type="button" class="half-picker-option" data-select-second-half="${item.id}" aria-pressed="${selected}" aria-label="Vybrat ${esc(name(item))} pro druhou půlku, ${money(itemPrice(item, draft.size))}"><img src="./${esc(item.image)}" width="58" height="58" alt="" loading="lazy"><span><strong>${esc(name(item))}</strong><small>${esc(item.description)}</small></span><span class="half-picker-price">${money(itemPrice(item, draft.size))}<i aria-hidden="true">${selected ? icon('check') : icon('plus')}</i></span></button>`;
    }).join('') || '<p class="half-picker-empty">Takovou pizzu tu nemáme. Zkus jiný název nebo surovinu.</p>';
    $('#half-picker-status', halfPicker).textContent = `${pizzas.length} ${pizzas.length === 1 ? 'pizza' : pizzas.length >= 2 && pizzas.length <= 4 ? 'pizzy' : 'pizz'} na výběr`;
  }
  function openHalfPicker() {
    if (!draft?.halves) return;
    halfPicker.innerHTML = `<div class="half-picker-shell"><header><p class="eyebrow">DRUHÁ PŮLKA TVOJÍ PIZZY</p><h2 id="half-picker-title">S ČÍM TO <em>SPOJÍME?</em></h2><p>První půlka: <strong>${esc(name(getItem(data, draft.itemId)))}</strong> · ${draft.size} cm</p>${closeButton('Zavřít výběr druhé půlky')}</header><label class="half-picker-search">${icon('search')}<input id="half-picker-search" type="search" placeholder="Najdi příchuť nebo surovinu…" aria-label="Najít pizzu pro druhou půlku" autocomplete="off" aria-controls="half-picker-results"></label><p id="half-picker-status" class="sr-only" role="status"></p><div id="half-picker-results" class="half-picker-results"></div><footer>Uvedené ceny jsou za celou pizzu. Základ se počítá podle dražší z obou půlek.</footer></div>`;
    renderHalfPickerItems();
    openDialog(halfPicker);
  }
  function toppingOptions() {
    if (!draft.halves) return `<div class="addon-grid">${addonOptions('dej-si-navic')}</div>`;
    return draft.halves.map((half, index) => `<section class="half-toppings" aria-labelledby="half-toppings-title-${index}"><h3 id="half-toppings-title-${index}"><i class="pizza-disc ${index ? 'disc-right' : 'disc-left'}" aria-hidden="true"></i><span>${index ? 'Druhá' : 'První'} půlka<small>${esc(name(getItem(data, half.itemId)))}</small></span></h3><div class="addon-grid">${addonOptions('dej-si-navic', index)}</div></section>`).join('');
  }
  function baseOptions() {
    if (draft.halves) return '';
    const part = draft;
    const base = part.base || recipeBase(getItem(data, part.itemId));
    return `<fieldset class="pizza-base"><legend>Vyber základ <span>změna zdarma</span></legend><div class="pizza-base-options">${Object.entries(PIZZA_BASES).map(([id, label]) => `<button type="button" data-pizza-base="${id}" aria-pressed="${base === id}"><i class="base-swatch" aria-hidden="true"></i><span>${label.replace(' základ', '')}</span>${icon('check')}</button>`).join('')}</div></fieldset>`;
  }
  function removalOptions(open = true) {
    const choices = removalChoices(draft, id => getItem(data, id));
    const removed = choices.filter(choice => choice.removed).length;
    return `<details class="ingredient-removal" ${open ? 'open' : ''}><summary><span><strong>Něco vynechat?</strong><small>${draft.halves ? 'Suroviny z obou půlek' : 'Původní suroviny'}</small></span><span class="removal-count">${removed ? removed + ' odebráno' : 'Upravit'}</span>${icon('chev')}</summary><p>${draft.halves ? 'Společné suroviny vynecháme z obou půlek.' : 'Zaškrtnuté suroviny vynecháme.'} Cena zůstává stejná.</p><div class="removal-options">${choices.map(choice => `<label><input type="checkbox" data-remove-ingredient="${esc(choice.ingredient)}" ${choice.checked ? 'checked' : ''}><span class="removal-copy"><span>${esc(choice.ingredient)}</span>${draft.halves ? `<small>${choice.targets.length === 2 ? 'Obě půlky' : `${choice.targets[0].index + 1}. půlka`}</small>` : ''}</span><small class="removal-status">${choice.mixed ? 'část vynechána' : 'vynechat'}</small></label>`).join('')}</div></details>`;
  }
  function syncRemovalChoices() {
    const choices = removalChoices(draft, id => getItem(data, id));
    $$('[data-remove-ingredient]', productPage).forEach(input => {
      const choice = choices.find(choice => choice.ingredient === input.dataset.removeIngredient);
      input.checked = choice.checked;
      input.indeterminate = choice.mixed;
      $('.removal-status', input.closest('label')).textContent = choice.mixed ? 'část vynechána' : 'vynechat';
    });
    const count = choices.filter(choice => choice.removed).length;
    $('.removal-count', productPage).textContent = count ? count + ' odebráno' : 'Upravit';
  }
  let productScrollFrame = 0;
  function syncProductSummary() {
    productScrollFrame = 0;
    if (productPage.hidden) return;
    const summary = $('.product-scroll-summary', productPage);
    const intro = $('.product-page-intro', productPage);
    if (!summary || !intro) return;
    const cartWidth = $('.site-header .cart-trigger').getBoundingClientRect().width + 'px';
    if (productPage.style.getPropertyValue('--product-back-width') !== cartWidth) productPage.style.setProperty('--product-back-width', cartWidth);
    const headerBottom = $('.site-header').getBoundingClientRect().bottom;
    const visible = intro.getBoundingClientRect().bottom <= headerBottom;
    summary.hidden = !visible;
    productPage.classList.toggle('has-product-summary', visible);
  }

  function scheduleProductSummary() {
    if (!productPage.hidden && !productScrollFrame) productScrollFrame = requestAnimationFrame(syncProductSummary);
  }
  window.addEventListener('scroll', scheduleProductSummary, { passive: true });
  window.addEventListener('resize', scheduleProductSummary);
  const productHeaderObserver = new ResizeObserver(scheduleProductSummary);
  productHeaderObserver.observe($('.site-header'));
  productHeaderObserver.observe($('.site-header .cart-trigger'));
  function renderProduct() {
    const item = getItem(data, draft.itemId);
    const pizza = item.categoryId === 'pizzy';
    document.title = `${draft.halves ? 'Pizza půl na půl' : name(item)} – upravit | Pizza Visi`;
    const note = `<label class="customize-note">Poznámka k ${pizza ? 'pizze' : 'položce'} <span>nepovinné</span><textarea id="product-note" rows="2" maxlength="180" placeholder="${pizza ? 'Např. prosím rozkrájet…' : 'Něco nám chceš vzkázat?'}">${esc(draft.note)}</textarea></label>`;
    $('#product-content', productPage).innerHTML = `<div class="product-page-shell">
      ${pizza ? `<div class="product-scroll-summary" hidden><div class="product-summary-identity">${productPhoto(draft)}<div class="product-summary-copy"><strong>${draft.halves ? 'Půl na půl' : esc(name(item))}</strong><small><span data-summary-size>${draft.size} cm</span>${draft.halves ? ` · ${esc(lineName(data, draft))}` : ''}</small></div><button type="button" class="product-back product-summary-back" data-product-back aria-label="Zpět na menu">${icon('back')}<span>Zpět</span></button></div></div>` : ''}
      <div class="product-page-intro">${productPhoto(draft)}<div class="product-intro-copy product-page-heading"><p class="eyebrow">${pizza ? 'PIZZA PŘESNĚ PODLE TEBE' : 'NĚCO DOBRÉHO NAVÍC'}</p><div class="product-title-row"><h1 id="product-title">${draft.halves ? 'PŮL NA PŮL' : esc(name(item))}</h1><button class="product-back product-page-back" data-product-back aria-label="Zpět na menu">${icon('back')}<span>Zpět</span></button></div></div><p class="product-description">${draft.halves ? esc(lineName(data, draft)) : esc(item.description || '')}</p></div>
      <div class="product-config ${pizza ? 'product-config-pizza' : ''}">${item.prices.length ? `<fieldset class="customize-size"><legend>Velikost pizzy</legend><div class="product-sizes">${[30,40].map(size => `<button type="button" data-option-size="${size}" aria-pressed="${draft.size === size}"><i class="size-disc size-disc-${size}" aria-hidden="true"></i><span class="size-label">${size}<small>cm</small></span><span data-base-size="${size}">${money(basePrice(data, draft, size))}</span></button>`).join('')}</div></fieldset><fieldset class="pizza-mode"><legend>Na co máš chuť?</legend><div class="pizza-mode-options"><button type="button" data-pizza-mode="whole" aria-pressed="${!draft.halves}"><i class="pizza-disc disc-whole" aria-hidden="true"></i>Celá pizza</button><button type="button" data-pizza-mode="half" aria-pressed="${Boolean(draft.halves)}"><i class="pizza-disc disc-split" aria-hidden="true"></i>Půl na půl</button></div></fieldset>` : `<p class="product-single-price">${money(itemPrice(item))}</p>`}${pizza && !draft.halves ? `<div id="base-options">${baseOptions()}</div>` : ''}${draft.halves ? '<p class="half-price-note">Cena podle dražší pizzy. Přísady pro každou půlku za běžnou cenu. Okraje a omáčka jsou k celé pizze.</p>' : ''}</div>
      <div class="product-page-body ${pizza ? '' : 'product-page-simple'}">${pizza ? `<section class="product-page-extras" aria-labelledby="product-extras-title">${halfChoices()}<h2 id="product-extras-title">Suroviny navíc</h2><div id="topping-options">${toppingOptions()}</div><div id="removal-options">${removalOptions()}</div></section><aside class="product-page-aside"><section aria-labelledby="product-crust-title"><h2 id="product-crust-title">Něco do okrajů</h2><div class="addon-grid addon-grid-single">${addonOptions('chutne-okraje')}</div></section><section aria-labelledby="product-sauce-title"><h2 id="product-sauce-title">Omáčka k pizze</h2><div class="addon-grid addon-grid-single">${addonOptions('omacky')}</div></section>${note}</aside>` : note}</div>
      <p class="customize-fine">${pizza ? 'Krabici připočítáme v košíku podle velikosti pizzy. ' : ''}Informace o alergenech ti sdělí pobočka.</p><div class="product-page-purchase customize-footer"><div id="product-quantity">${stepper(draft.quantity, 'draft', lineName(data, draft))}</div><button class="button" data-add-cart><span>${productSession.snapshot ? 'Uložit úpravy' : 'Přidat do košíku'}</span><strong id="product-total" aria-live="polite">${money(unitPrice(data, draft) * draft.quantity)}</strong>${icon('arrow')}</button></div></div>`;
    if (pizza) syncRemovalChoices();
    syncProductSummary();
  }
  function updateProductPrice() {
    const summarySize = $('[data-summary-size]', productPage);
    if (summarySize) summarySize.textContent = draft.size + ' cm';
    $$('[data-option-size]', productPage).forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.optionSize) === draft.size)));
    $$('[data-base-size]', productPage).forEach(label => { label.textContent = money(basePrice(data, draft, Number(label.dataset.baseSize))); });
    const secondPrice = $('[data-second-half-price]', productPage);
    if (secondPrice) secondPrice.textContent = money(itemPrice(getItem(data, draft.halves[1].itemId), draft.size));
    $$('[data-addon-price]', productPage).forEach(label => { label.textContent = '+' + money(itemPrice(getItem(data, label.dataset.addonPrice), draft.size)); });
    $('#product-total', productPage).textContent = money(unitPrice(data, draft) * draft.quantity);
    $('#product-quantity', productPage).innerHTML = stepper(draft.quantity, 'draft', lineName(data, draft));
  }
  function addDraft() {
    if (!draft) return;
    const line = normalizeLine(data, draft);
    const updated = Boolean(productSession.snapshot);
    const index = findEditingLine(cart, productSession.snapshot);
    if (productSession.snapshot && index < 0) {
      toast('Položka v košíku se mezitím změnila. Otevři její úpravu z košíku znovu.');
      openCart();
      return;
    }
    cart = mergeLine(cart, line, index);
    saveCart();
    leaveProduct({ restoreFocus: false });
    openCart();
    const item = getItem(data, line.itemId);
    showCartFeedback?.({ name: lineName(data, line), image: item.image || null, secondImage: line.halves ? getItem(data, line.halves[1].itemId).image : null, size: line.size, quantity: line.quantity, updated });
  }
  function fulfillmentControls() {
    return `<div class="fulfillment-options" role="group" aria-label="Způsob převzetí"><button type="button" data-fulfillment="delivery" aria-pressed="${fulfillment === 'delivery'}">${icon('truck')}<span>Doručení<small>${money(data.delivery.price_czk)} · 30–90 min</small></span></button><button type="button" data-fulfillment="pickup" aria-pressed="${fulfillment === 'pickup'}">${icon('bag')}<span>Vyzvednutí<small>Zdarma · 10–30 min</small></span></button></div>`;
  }
  function summaryRows(total) {
    return `<dl class="price-summary"><div><dt>Jídlo a přísady</dt><dd>${money(total.subtotal)}</dd></div><div><dt>Krabice na pizzu</dt><dd>${money(total.packaging)}</dd></div><div><dt>${fulfillment === 'delivery' ? 'Rozvoz' : 'Osobní vyzvednutí'}</dt><dd>${total.delivery ? money(total.delivery) : 'Zdarma'}</dd></div><div class="price-total"><dt>Celkem</dt><dd>${money(total.total)}</dd></div></dl>`;
  }
  function cartLine(line, index) {
    const label = esc(lineName(data, line));
    return `<article class="cart-line">${productPhoto(line, 'cart-line-image')}<div class="cart-line-copy"><div class="cart-line-title"><h3>${label}</h3><button class="cart-remove" data-remove-line="${index}" aria-label="Odebrat ${label}">${icon('close')}</button></div><div class="cart-line-meta"><span>${line.size ? `${line.size} cm` : '1 porce / balení'}</span><button class="cart-edit" data-edit-line="${index}" aria-label="Upravit ${label}">Upravit</button></div>${lineDetails(data, line).map(detail => `<p>${esc(detail)}</p>`).join('')}${line.note ? `<p class="cart-line-note">${esc(line.note)}</p>` : ''}<div class="cart-line-purchase"><strong>${money(unitPrice(data, line) * line.quantity)}</strong>${stepper(line.quantity, String(index), lineName(data, line))}</div></div></article>`;
  }
  function openCart() {
    if (submitting) return;
    captureCustomer();
    renderCart();
    openDialog(cartDialog);
    // Announce the drawer title without focusing (and highlighting) the close button.
    $('#cart-title', cartDialog).focus({ preventScroll: true });
  }
  function upsellCards() {
    const drinks = data.categories.find(category => category.id === 'napoje')?.items || [];
    const featured = ['coca-cola-0-5l', 'fanta-pomeranc-0-5l', 'sprite-0-5l'];
    const ordered = [...featured.map(id => drinks.find(item => item.id === id)).filter(Boolean), ...drinks.filter(item => !featured.includes(item.id))];
    return ordered.map(item => `<button class="cart-upsell-card" data-quick-drink="${esc(item.id)}" aria-label="Přidat ${esc(name(item))} za ${money(itemPrice(item))}">${item.image ? `<figure class="cart-upsell-photo"><img src="./${esc(item.image)}" alt="" loading="lazy"></figure>` : icon('bag')}<span>${esc(name(item))}</span><strong>${money(itemPrice(item))}<span class="cart-upsell-add" aria-hidden="true">${icon('plus')}</span></strong></button>`).join('');
  }
  function renderCart() {
    const scrollTop = $('.cart-scroll', cartDialog)?.scrollTop || 0;
    const drinkScrollLeft = $('.cart-upsell-grid', cartDialog)?.scrollLeft || 0;
    const branch = getBranch();
    const total = totals();
    $('#cart-content').innerHTML = `<div class="cart-shell"><header class="cart-heading"><h2 id="cart-title" tabindex="-1">TVŮJ <em>KOŠÍK</em> <span>${total.quantity}</span></h2>${closeButton('Zavřít košík')}</header>${!cart.length ? `<div class="cart-scroll empty-cart">${icon('cart')}<h3>ZATÍM ANI KOUSEK</h3><p>Vyber si pizzu, přidej něco navíc<br>a udělej si hezký den.</p><button class="button" data-continue-menu>Vybrat si pizzu ${icon('arrow')}</button>${receipt ? `<button class="small-text-button last-receipt" data-last-receipt>Poslední objednávka ${icon('external')}</button>` : ''}</div>` : `<div class="cart-scroll"><div class="cart-body"><div class="cart-branch"><span>${icon('pin')} ${branch ? `Pizza Visi ${esc(branch.name)}` : 'Pobočku určíme v objednávce'}</span></div><p class="cart-next-step-note">Doručení nebo vyzvednutí vybereš v dalším kroku.</p><div class="cart-lines">${cart.map(cartLine).join('')}</div><section class="cart-upsell" aria-labelledby="cart-drinks-title"><div class="cart-upsell-heading"><h3 id="cart-drinks-title">JEŠTĚ NĚCO NA ZAPITÍ?</h3><div class="cart-upsell-nav"><button data-drinks-scroll="-1" aria-label="Předchozí nápoje">${icon('back')}</button><button data-drinks-scroll="1" aria-label="Další nápoje">${icon('arrow')}</button></div></div><div class="cart-upsell-grid">${upsellCards()}</div></section></div></div><footer class="cart-footer">${summaryRows(total)}<button class="button cart-checkout" data-checkout>Pokračovat k objednávce ${icon('arrow')}</button><button class="cart-continue" data-close-dialog>Ještě něco přihodím</button></footer>`}</div>`;
    $('.cart-scroll', cartDialog).scrollTop = scrollTop;
    const drinks = $('.cart-upsell-grid', cartDialog);
    if (drinks) drinks.scrollLeft = drinkScrollLeft;
  }
  function openCheckout() {
    if (!cart.length) return openCart();
    captureCustomer();
    if (checkoutPage.hidden) checkoutReturn = productSession?.returnTo || menuReturn();
    receipt = null;
    cartDialog.close();
    if (location.hash !== '#objednavka') history.pushState(clearRouteState(), '', '#objednavka');
    syncProductRoute();
  }
  function showCheckoutPage() {
    if (!cart.length && !receipt) {
      history.replaceState(clearRouteState(), '', '#menu');
      revealStorefront({ section: true });
      toast('Nejprve si vyber něco dobrého do košíku.');
      return;
    }
    const wasHidden = checkoutPage.hidden;
    if (wasHidden && !checkoutReturn) checkoutReturn = productSession?.returnTo || { hash: '#menu', scroll: null, focus: null };
    captureCustomer();
    productPage.hidden = true;
    storefront.hidden = true;
    siteFooter.hidden = true;
    checkoutPage.hidden = false;
    document.body.classList.remove('product-open');
    document.body.classList.add('checkout-open');
    document.title = receipt ? 'Objednávka uložena | Pizza Visi' : 'Dokončit objednávku | Pizza Visi';
    if (receipt) renderReceipt(); else renderCheckout();
    if (wasHidden) {
      window.scrollTo({ top: 0, behavior: 'instant' });
      checkoutPage.focus({ preventScroll: true });
    }
    if (!addressBook && !addressLoading && !receipt) loadAddresses();
  }
  async function loadAddresses() {
    addressLoading = true;
    addressLoadError = false;
    try { addressBook = await loadRuianAddresses(); }
    catch { addressLoadError = true; }
    finally {
      addressLoading = false;
      if (!checkoutPage.hidden && !receipt) {
        const status = $('#address-status', checkoutPage);
        if (status) status.textContent = addressLoadError ? 'Adresy se nepodařilo načíst. Zkus to znovu nebo zvol vyzvednutí.' : 'Začni psát ulici, číslo domu a město. Vyber adresu ze seznamu.';
        if (customer.address && !selectedAddressId && document.activeElement?.id === 'checkout-address') updateAddressSuggestions();
      }
    }
  }
  function captureCustomer() {
    if (checkoutPage.hidden) return;
    const form = $('#checkout-form', checkoutPage);
    if (!form) return;
    for (const key of ['name', 'phone', 'email', 'address', 'note']) {
      const field = form.elements.namedItem(key);
      if (field) customer[key] = field.value;
    }
    customer.payment = 'cash';
  }
  function paymentCards() {
    const apple = '<img class="payment-brand payment-brand-apple" src="./assets/payments/apple-pay-symbol.svg" alt="" aria-hidden="true">';
    const google = '<img class="payment-brand payment-brand-google" src="./assets/payments/google-pay-symbol.svg" alt="" aria-hidden="true">';
    return `<fieldset class="checkout-payment"><legend>3. Platba</legend><div class="payment-options"><label class="payment-choice"><input type="radio" name="payment" value="cash" checked>${icon('cash')}<span>Hotově<small>Při převzetí</small></span></label><label class="payment-choice unavailable"><input type="radio" name="payment" value="card" disabled>${icon('card')}<span>Kartou online<small>Zatím nepřipojeno</small></span></label><label class="payment-choice unavailable"><input type="radio" name="payment" value="applepay" disabled>${apple}<span class="sr-only">Apple Pay — zatím nedostupné</span></label><label class="payment-choice unavailable"><input type="radio" name="payment" value="googlepay" disabled>${google}<span class="sr-only">Google Pay — zatím nedostupné</span></label></div><p class="checkout-help">Online platby zatím nejsou připojené. Zaplatíš hotově při převzetí.</p></fieldset>`;
  }
  function addressField() {
    return `<div class="checkout-address-box"><div class="checkout-branch checkout-address-heading"><label for="checkout-address">Doručovací adresa</label></div><div class="address-combobox"><input name="address" id="checkout-address" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="ruian-results" aria-describedby="address-status" autocomplete="off" required minlength="4" maxlength="200" placeholder="Ulice, číslo domu, město" value="${esc(customer.address)}"><ul id="ruian-results" class="ruian-results" role="listbox" hidden></ul></div><p id="address-status" class="checkout-help" role="status">${selectedAddressId ? 'Adresa vybraná z registru RÚIAN.' : addressLoading ? 'Načítáme adresy…' : addressLoadError ? 'Adresy se nepodařilo načíst. Zkus znovu otevřít objednávku.' : 'Začni psát a vyber přesnou adresu ze seznamu RÚIAN.'}</p><div id="checkout-assigned-branch" role="status">${assignedBranch()}</div></div>`;
  }
  function assignedBranch() {
    const branch = selectedAddressId && getBranch();
    return branch ? `<p class="assigned-branch">${icon('check')}<span>Připraví a přiveze <strong>Pizza Visi ${esc(branch.name)}</strong></span></p>` : '<p class="checkout-help">Pobočku vybereme automaticky podle adresy doručení.</p>';
  }
  function pickupBranches() {
    const selected = getBranch();
    return `<div class="checkout-pickup-branches" role="group" aria-label="Pobočka pro vyzvednutí">${data.branches.map(branch => `<button type="button" data-pickup-branch="${esc(branch.id)}" aria-pressed="${selected?.id === branch.id}" aria-controls="pickup-branch-details" aria-label="Vyzvednout v pobočce ${esc(branch.name)}"><img src="./${esc(branch.image)}" alt="" loading="lazy"><span>${icon(selected?.id === branch.id ? 'check' : 'pin')}<strong>${esc(branch.name)}</strong></span></button>`).join('')}</div><div id="pickup-branch-details">${selected ? pickupBranchDetails(selected) : ''}</div><p class="checkout-help">Osobní vyzvednutí zdarma, orientačně za 10–30 minut.</p>`;
  }
  function pickupBranchDetails(branch) {
    const [lat, lon] = branch.coordinates;
    const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${lat},${lon}`)}`;
    return `<section class="pickup-branch-detail" aria-label="Kde nás najdeš: ${esc(branch.name)}"><div class="pickup-branch-location"><span>${icon('pin')}<span><strong>Pizza Visi ${esc(branch.name)}</strong><span>${esc(branch.address)}</span></span></span><a href="${esc(directionsUrl)}" target="_blank" rel="noopener noreferrer">Navigovat ${icon('external')}</a></div><div class="pickup-branch-map" role="region" aria-label="Mapa pobočky Pizza Visi ${esc(branch.name)}"></div></section>`;
  }
  function rememberPreference() {
    return `<label class="checkout-remember"><input id="checkout-remember" type="checkbox" ${getRememberPreference?.() ? 'checked' : ''}><span>Zapamatovat pro příště<small>Adresu nebo pobočku uložíme jen v tomto prohlížeči.</small></span></label>`;
  }
  function syncRememberPreference() {
    const checkbox = $('#checkout-remember', checkoutPage);
    if (checkbox) checkbox.checked = Boolean(getRememberPreference?.());
  }
  function checkoutSubmitContent() {
    return `<span>Objednat<span class="checkout-submit-total"> · ${money(totals().total)}</span></span>${icon('arrow')}`;
  }
  let clearPickupMap;
  function renderCheckout() {
    clearPickupMap?.(); clearPickupMap = null;
    addressResults = []; addressActive = -1;
    $('#checkout-content', checkoutPage).innerHTML = `<div class="checkout-page-shell"><div class="checkout-page-top"><button class="checkout-page-back" data-back-cart>${icon('back')} Zpět do košíku</button><span>KOŠÍK <i>${icon('chev-right')}</i> <strong>DOKONČENÍ</strong></span></div><header class="checkout-heading"><p class="eyebrow">UŽ JEN POSLEDNÍ KOUSEK</p><h1 id="checkout-title">KAM TO <em>BUDE?</em></h1></header><div class="checkout-layout"><form id="checkout-form"><fieldset class="checkout-contact"><legend>1. Kontakt</legend><div class="checkout-field-grid"><label class="checkout-field">Jméno<input name="name" autocomplete="name" required minlength="2" maxlength="70" placeholder="Tvoje jméno" value="${esc(customer.name)}"></label><label class="checkout-field">Telefon<input name="phone" type="tel" autocomplete="tel" required maxlength="20" placeholder="777 000 000" value="${esc(customer.phone)}"></label></div><label class="checkout-field">E-mail <span>nepovinný</span><input name="email" type="email" autocomplete="email" maxlength="120" placeholder="tvuj@email.cz" value="${esc(customer.email)}"></label></fieldset><fieldset class="checkout-delivery"><legend>2. Převzetí</legend>${fulfillmentControls()}${fulfillment === 'delivery' ? addressField() : pickupBranches()}${rememberPreference()}</fieldset>${paymentCards()}</form><aside class="checkout-summary"><p class="eyebrow">TVŮJ VÝBĚR</p><h2>TVOJE OBJEDNÁVKA</h2><div class="checkout-mini-lines">${cart.map(line => { return `<div><span><strong>${line.quantity}× ${esc(lineName(data, line))}</strong><small>${line.size ? line.size + ' cm' : ''}</small>${lineDetails(data, line).map(detail => `<small>${esc(detail)}</small>`).join('')}${line.note ? `<small>${esc(line.note)}</small>` : ''}</span><b>${money(unitPrice(data, line) * line.quantity)}</b></div>`; }).join('')}</div>${summaryRows(totals())}<label class="checkout-field checkout-order-note">Poznámka <span>nepovinná</span><textarea name="note" form="checkout-form" rows="2" maxlength="250" placeholder="Např. zvonek nebo patro…">${esc(customer.note)}</textarea></label><p id="checkout-error" class="checkout-error" role="alert" tabindex="-1"></p><div class="checkout-submit-bar"><button class="button checkout-submit" type="submit" form="checkout-form" ${submitting ? 'disabled' : ''}>${submitting ? 'Ukládáme objednávku…' : checkoutSubmitContent()}</button></div><p class="checkout-local-note">Objednávka se uloží do místní administrace v tomto prohlížeči.</p></aside></div></div>`;
    const mapElement = $('.pickup-branch-map', checkoutPage);
    if (mapElement) clearPickupMap = mountPickupMap(mapElement, getBranch());
  }
  function closeAddressSuggestions() {
    const input = $('#checkout-address', checkoutPage);
    const list = $('#ruian-results', checkoutPage);
    if (input) { input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); }
    if (list) list.hidden = true;
    addressActive = -1;
  }
  function updateAddressSuggestions() {
    const input = $('#checkout-address', checkoutPage);
    if (!input || !addressBook) return;
    addressResults = searchAddresses(addressBook, input.value, 8);
    addressActive = -1;
    const list = $('#ruian-results', checkoutPage);
    list.innerHTML = addressResults.map((address, index) => `<li id="ruian-result-${index}" role="option" aria-selected="false" data-address-id="${esc(address.id)}">${esc(address.label)}</li>`).join('');
    list.hidden = !addressResults.length;
    input.setAttribute('aria-expanded', String(addressResults.length > 0));
    input.removeAttribute('aria-activedescendant');
    $('#address-status', checkoutPage).textContent = addressResults.length ? `${addressResults.length} ${addressResults.length === 1 ? 'adresa' : addressResults.length < 5 ? 'adresy' : 'adres'}. Vyber správnou šipkami a Enterem nebo kliknutím.` : input.value.trim().length < 3 ? 'Napiš alespoň 3 znaky.' : 'Adresu jsme nenašli. Zkus ulici, číslo domu a město. Dostupný je rozvoz Rudná a Hostivice.';
  }
  function selectAddress(id, { pointerType } = {}) {
    if (submitting) return;
    const address = addressBook && resolveAddress(addressBook, id);
    if (!address) return;
    ++deliverySelectionVersion;
    captureCustomer();
    selectedAddressId = address.id;
    customer.address = address.label;
    const input = $('#checkout-address', checkoutPage);
    input.value = address.label;
    setBranch(address.branchIds[0]);
    closeAddressSuggestions();
    addressResults = [];
    $('#address-status', checkoutPage).textContent = 'Adresa vybraná z registru RÚIAN.';
    $('#checkout-assigned-branch', checkoutPage).innerHTML = assignedBranch();
    $('#checkout-error', checkoutPage).textContent = '';
    // Keep the form in place instead of replacing the focused mobile input.
    if (pointerType === 'touch' || pointerType === 'pen') input.blur();
    onDeliveryChange?.(getDeliverySelection());
  }
  async function submitCheckout() {
    if (submitting) return;
    captureCustomer();
    const error = $('#checkout-error', checkoutPage);
    error.textContent = '';
    if (customer.name.trim().length < 2) { error.textContent = 'Doplň prosím jméno.'; $('#checkout-form [name="name"]', checkoutPage).focus(); return; }
    if (!/^\+?[\d\s()-]+$/.test(customer.phone.trim()) || !/^\d{9,15}$/.test(customer.phone.replace(/\D/g, ''))) { error.textContent = 'Zadej prosím platný telefon.'; $('#checkout-form [name="phone"]', checkoutPage).focus(); return; }
    if (fulfillment === 'pickup' && !getBranch()) { error.textContent = 'Vyber pobočku pro vyzvednutí.'; $('[data-pickup-branch]', checkoutPage)?.focus(); return; }
    let address = null;
    if (fulfillment === 'delivery') {
      address = addressBook && resolveAddress(addressBook, selectedAddressId);
      if (!address || address.label !== customer.address || !address.branchIds.includes(getBranch()?.id)) {
        error.textContent = 'Vyber přesnou doručovací adresu ze seznamu RÚIAN.';
        $('#checkout-address', checkoutPage)?.focus();
        return;
      }
    }
    submitting = true;
    checkoutPage.setAttribute('aria-busy', 'true');
    $('#checkout-form', checkoutPage).inert = true;
    $('.checkout-summary', checkoutPage).inert = true;
    submissionKey ||= crypto.randomUUID();
    const button = $('.checkout-submit', checkoutPage);
    button.disabled = true; button.textContent = 'Ukládáme objednávku…';
    const snapshot = { lines: cart.map(cloneLine), total: totals(), branch: { ...getBranch() }, customer: { ...customer }, fulfillment, address };
    try {
      const saved = await submitLocalOrder({ data, cart: snapshot.lines, fulfillment, customer: { ...customer }, branchId: getBranch().id, addressId: address?.id || null, idempotencyKey: submissionKey });
      receipt = { ...saved, ...snapshot, payment: 'cash' };
      cart = []; saveCart();
      renderReceipt();
      document.title = 'Objednávka uložena | Pizza Visi';
      window.scrollTo({ top: 0, behavior: 'instant' });
      $('#checkout-title', checkoutPage).focus({ preventScroll: true });
    } catch (failure) {
      const currentError = $('#checkout-error', checkoutPage);
      if (currentError) currentError.textContent = failure?.message || 'Objednávku se nepodařilo uložit. Košík zůstal beze změny.';
    } finally {
      submitting = false;
      checkoutPage.removeAttribute('aria-busy');
      for (const element of $$('#checkout-form,.checkout-summary', checkoutPage)) element.inert = false;
      const currentButton = $('.checkout-submit', checkoutPage);
      if (currentButton) { currentButton.disabled = false; currentButton.innerHTML = checkoutSubmitContent(); }
      const currentError = $('#checkout-error', checkoutPage);
      if (!checkoutPage.hidden && currentError?.textContent) { currentError.focus(); currentError.scrollIntoView({ block: 'center', behavior: 'instant' }); }
    }
  }
  function renderReceipt() {
    clearPickupMap?.(); clearPickupMap = null;
    const delivery = receipt.fulfillment === 'delivery';
    $('#checkout-content', checkoutPage).innerHTML = `<section class="receipt-view"><span class="receipt-check">${icon('check')}</span><p class="eyebrow">DĚKUJEME ZA OBJEDNÁVKU</p><h1 id="checkout-title" tabindex="-1">OBJEDNÁVKA<br><em>ULOŽENA</em></h1><p class="receipt-intro">Objednávka je v místní administraci.<br>Číslo <strong>${esc(receipt.orderId || receipt.id)}</strong></p><div class="receipt-details"><div><span>POBOČKA</span><strong>Pizza Visi ${esc(receipt.branch.name)}</strong></div><div><span>${delivery ? 'DORUČENÍ' : 'VYZVEDNUTÍ'}</span><strong>${esc(delivery ? receipt.customer.address : receipt.branch.address)}</strong></div><div><span>PLATBA</span><strong>Hotově při převzetí</strong></div><div><span>CELKEM</span><strong>${money(receipt.total.total)}</strong></div></div><details class="receipt-items"><summary>Zobrazit objednávku (${receipt.total.quantity} ks)</summary>${receipt.lines.map(line => `<p><span>${line.quantity}× ${esc(lineName(data, line))} ${line.size ? '· ' + line.size + ' cm' : ''}${lineDetails(data, line).map(detail => `<small>${esc(detail)}</small>`).join('')}${line.note ? `<small>${esc(line.note)}</small>` : ''}</span><strong>${money(unitPrice(data, line) * line.quantity)}</strong></p>`).join('')}</details><p class="receipt-local-note">Uloženo v tomto prohlížeči. Platba online neproběhla a objednávka nebyla odeslána restauraci.</p><button class="button" data-continue-menu>Zpět na menu ${icon('arrow')}</button></section>`;
  }

  document.addEventListener('click', event => {
    const target = event.target.closest('button,a');
    if (!target || productPage.contains(target)) return;
    if (submitting) { event.preventDefault(); return; }
    if ((productSession || !checkoutPage.hidden) && target.matches('a[href^="#"]') && !parseProductRoute(target.getAttribute('href'), data)) {
      event.preventDefault();
      showSection(target.getAttribute('href'));
      return;
    }
    if (target.hasAttribute('data-open-cart')) openCart();
    if (target.hasAttribute('data-quantity')) {
      const delta = Number(target.dataset.delta);
      const index = Number(target.dataset.quantity);
      if (!cart[index]) return;
      cart[index].quantity = Math.max(1, Math.min(MAX_QUANTITY, cart[index].quantity + delta));
      saveCart(); renderCart();
      const quantityButton = $(`[data-quantity="${index}"][data-delta="${delta}"]:not(:disabled)`, cartDialog) || $(`[data-quantity="${index}"]:not(:disabled)`, cartDialog);
      quantityButton?.focus({ preventScroll: true });
    }
    if (target.hasAttribute('data-remove-line')) { cart.splice(Number(target.dataset.removeLine), 1); saveCart(); renderCart(); }
    if (target.hasAttribute('data-edit-line')) { const index = Number(target.dataset.editLine); if (cart[index]) openProduct(cart[index].itemId, index); }
    if (target.dataset.fulfillment && target.dataset.fulfillment !== fulfillment) {
      ++deliverySelectionVersion;
      captureCustomer(); fulfillment = target.dataset.fulfillment; updateBadge();
      selectedAddressId = null; customer.address = ''; setBranch(null);
      if (cartDialog.open) renderCart(); else renderCheckout();
      $(`[data-fulfillment="${fulfillment}"]`, cartDialog.open ? cartDialog : checkoutPage).focus();
      onDeliveryChange?.(getDeliverySelection());
    }
    if (target.dataset.drinksScroll) {
      const drinks = $('.cart-upsell-grid', cartDialog);
      drinks.scrollBy({ left: Number(target.dataset.drinksScroll) * drinks.clientWidth * .85, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
    if (target.dataset.quickDrink) {
      quickAdd(target.dataset.quickDrink);
      $(`[data-quick-drink="${target.dataset.quickDrink}"]`, cartDialog)?.focus({ preventScroll: true });
    }
    if (target.dataset.pickupBranch && fulfillment === 'pickup') {
      captureCustomer();
      ++deliverySelectionVersion;
      setBranch(target.dataset.pickupBranch);
      renderCheckout();
      $(`[data-pickup-branch="${getBranch().id}"]`, checkoutPage)?.focus();
      onDeliveryChange?.(getDeliverySelection());
    }
    if (target.hasAttribute('data-checkout')) openCheckout();
    if (target.hasAttribute('data-back-cart')) {
      captureCustomer();
      history.replaceState(clearRouteState(), '', `${location.pathname}${location.search}${checkoutReturn?.hash || '#menu'}`);
      syncProductRoute(); openCart();
    }
    if (target.hasAttribute('data-last-receipt') && receipt) { cartDialog.close(); history.pushState(clearRouteState(), '', '#objednavka'); showCheckoutPage(); }
    if (target.hasAttribute('data-continue-menu')) {
      cartDialog.close();
      if (productSession || !checkoutPage.hidden) showSection('#menu');
      else $('#menu').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
  });
  productPage.addEventListener('click', event => {
    const target = event.target.closest('button');
    if (!target || !draft) return;
    if (target.hasAttribute('data-open-half-picker')) { openHalfPicker(); return; }
    if (target.hasAttribute('data-product-back')) { leaveProduct({ back: true }); return; }
    if (target.dataset.optionSize) {
      draft.size = Number(target.dataset.optionSize) === 40 ? 40 : 30;
      history.replaceState(routeState(productSession.key), '', productHash(draft.itemId, draft.size));
      activeProductHash = location.hash;
      updateProductPrice();
    }
    if (target.dataset.pizzaMode) {
      if (target.dataset.pizzaMode === 'half' && !draft.halves) {
        const toppings = new Set(data.categories.find(c => c.id === 'dej-si-navic').items.map(item => item.id));
        draft.halves = [{ itemId: draft.itemId, extras: draft.extras.filter(id => toppings.has(id)), ...customizationFields(draft) }, { itemId: draft.itemId, extras: [] }];
        delete draft.base;
        delete draft.removedIngredients;
        draft.extras = draft.extras.filter(id => !toppings.has(id));
      } else if (target.dataset.pizzaMode === 'whole' && draft.halves) {
        draft.extras = [...draft.extras, ...draft.halves[0].extras].sort();
        Object.assign(draft, customizationFields(draft.halves[0]));
        delete draft.halves;
      }
      renderProduct();
      $(`[data-pizza-mode="${target.dataset.pizzaMode}"]`, productPage).focus({ preventScroll: true });
    }
    if (!draft.halves && target.dataset.pizzaBase && Object.hasOwn(PIZZA_BASES, target.dataset.pizzaBase)) {
      const part = draft;
      const previousBase = removableIngredients(getItem(data, part.itemId), part)[0];
      const changed = target.dataset.pizzaBase !== (part.base || recipeBase(getItem(data, part.itemId)));
      part.base = target.dataset.pizzaBase;
      if (part.base === recipeBase(getItem(data, part.itemId))) delete part.base;
      if (changed && part.removedIngredients?.includes(previousBase)) {
        part.removedIngredients = part.removedIngredients.filter(ingredient => ingredient !== previousBase);
        if (!part.removedIngredients.length) delete part.removedIngredients;
      }
      $$('[data-pizza-base]', productPage).forEach(button => button.setAttribute('aria-pressed', String(button === target)));
      const removalOpen = $('.ingredient-removal', productPage).open;
      $('#removal-options', productPage).innerHTML = removalOptions(removalOpen);
      syncRemovalChoices();
    }
    if (target.hasAttribute('data-add-cart')) addDraft();
    if (target.dataset.quantity === 'draft') {
      const delta = Number(target.dataset.delta);
      draft.quantity = Math.max(1, Math.min(MAX_QUANTITY, draft.quantity + delta));
      updateProductPrice();
      const preferred = $(`[data-quantity="draft"][data-delta="${delta}"]`, productPage);
      (preferred.disabled ? $(`[data-quantity="draft"]:not(:disabled)`, productPage) : preferred)?.focus();
    }
  });
  productPage.addEventListener('change', event => {
    if (!draft) return;
    if (event.target.dataset.addon) {
      const part = event.target.dataset.half === undefined ? draft : draft.halves[Number(event.target.dataset.half)];
      const selected = new Set(part.extras);
      if (event.target.checked) selected.add(event.target.dataset.addon); else selected.delete(event.target.dataset.addon);
      part.extras = [...selected].sort(); updateProductPrice();
    }
    if (event.target.dataset.removeIngredient) {
      setIngredientRemoval(draft, id => getItem(data, id), event.target.dataset.removeIngredient, event.target.checked);
      syncRemovalChoices();
    }
  });
  productPage.addEventListener('input', event => { if (event.target.id === 'product-note' && draft) draft.note = event.target.value; });
  checkoutPage.addEventListener('input', event => {
    if (submitting) return;
    captureCustomer();
    if (event.target.id === 'checkout-address') {
      ++deliverySelectionVersion;
      selectedAddressId = null;
      setBranch(null);
      $('#checkout-assigned-branch', checkoutPage).innerHTML = assignedBranch();
      updateAddressSuggestions();
      onDeliveryChange?.(getDeliverySelection());
    }
  });
  checkoutPage.addEventListener('change', event => {
    captureCustomer();
    if (event.target.id === 'checkout-remember') onRememberChange?.(event.target.checked);
  });
  checkoutPage.addEventListener('submit', event => { if (event.target.id === 'checkout-form') { event.preventDefault(); submitCheckout(); } });
  bindAddressSuggestionEvents(checkoutPage, { select: selectAddress, close: closeAddressSuggestions });
  checkoutPage.addEventListener('focusin', event => { if (event.target.id === 'checkout-address' && !selectedAddressId) updateAddressSuggestions(); });
  checkoutPage.addEventListener('keydown', event => {
    if (event.target.id !== 'checkout-address') return;
    if (event.key === 'Escape') { event.preventDefault(); closeAddressSuggestions(); return; }
    if (event.key === 'Enter' && addressActive >= 0) { event.preventDefault(); selectAddress(addressResults[addressActive].id); return; }
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    if (!addressResults.length) updateAddressSuggestions();
    if (!addressResults.length) return;
    addressActive = addressActive < 0 ? (event.key === 'ArrowDown' ? 0 : addressResults.length - 1) : (addressActive + (event.key === 'ArrowDown' ? 1 : -1) + addressResults.length) % addressResults.length;
    const list = $('#ruian-results', checkoutPage); list.hidden = false;
    event.target.setAttribute('aria-expanded', 'true');
    event.target.setAttribute('aria-activedescendant', `ruian-result-${addressActive}`);
    $$('[role="option"]', list).forEach((option, index) => option.setAttribute('aria-selected', String(index === addressActive)));
    $(`#ruian-result-${addressActive}`, list).scrollIntoView({ block: 'nearest' });
  });
  halfPicker.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); halfPicker.close(); }
  });
  halfPicker.addEventListener('input', event => {
    if (event.target.id === 'half-picker-search' && draft?.halves) renderHalfPickerItems(event.target.value);
  });
  halfPicker.addEventListener('click', event => {
    const choice = event.target.closest('[data-select-second-half]');
    if (!choice || !draft?.halves || getItem(data, choice.dataset.selectSecondHalf)?.categoryId !== 'pizzy') return;
    if (draft.halves[1].itemId !== choice.dataset.selectSecondHalf) {
      draft.halves[1].itemId = choice.dataset.selectSecondHalf;
      delete draft.halves[1].base;
      delete draft.halves[1].removedIngredients;
    }
    halfPicker.close();
    renderProduct();
  });
  halfPicker.addEventListener('close', () => {
    if (!productPage.hidden) $('[data-open-half-picker]', productPage)?.focus({ preventScroll: true });
  });
  cartDialog.addEventListener('close', () => { if (!checkoutPage.hidden && !receipt) { captureCustomer(); renderCheckout(); } });
  updateBadge();
  function initRoute() {
    if (routeReady) return;
    routeReady = true;
    window.addEventListener('hashchange', () => syncProductRoute());
    window.addEventListener('popstate', () => syncProductRoute());
    syncProductRoute();
  }
  return { openProduct: (id, size) => openProduct(id, -1, size), quickAdd, initRoute, showSection, openCart, setAddress, applyDeliverySelection, getDeliverySelection, syncRememberPreference, branchChanged: () => { if (cartDialog.open) renderCart(); if (!checkoutPage.hidden && !receipt && !submitting) { captureCustomer(); renderCheckout(); } } };
}
