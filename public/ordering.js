import { itemPrice } from './menu-utils.js';
import { matchDeliveryBranch } from './delivery-demo.js';
import { MAX_QUANTITY, getItem, normalizeLine, mergeLine, unitPrice, cartTotals, restoreCart, serializeCart } from './cart-model.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const money = value => `${new Intl.NumberFormat('cs-CZ').format(value)} Kč`;
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const name = item => item.name.replace(/^\d+\.\s*/, '').replace(/\s*🌶️?/gu, '').trim();
const CART_KEY = 'pizza-visi-demo-cart-v1';
const demoNotice = '<span class="demo-pill">DEMO</span><span>Jen na zkoušku. Nic se neodesílá ani neplatí.</span>';
const closeButton = label => `<button class="icon-button dialog-close" data-close-dialog aria-label="${label}">${icon('close')}</button>`;
const stepper = (quantity, scope, label) => `<div class="quantity-stepper" role="group" aria-label="Počet: ${esc(label)}"><button data-quantity="${scope}" data-delta="-1" aria-label="Ubrat kus: ${esc(label)}" ${quantity <= 1 ? 'disabled' : ''}>${icon('minus')}</button><span aria-live="polite">${quantity}</span><button data-quantity="${scope}" data-delta="1" aria-label="Přidat kus: ${esc(label)}" ${quantity >= MAX_QUANTITY ? 'disabled' : ''}>${icon('plus')}</button></div>`;

export function createOrdering(context) {
  const { data, openDialog, toast, getBranch, chooseBranch, setBranch } = context;
  const productDialog = $('#product-dialog');
  const cartDialog = $('#cart-dialog');
  const checkoutDialog = $('#checkout-dialog');
  let cart = [];
  try { cart = restoreCart(data, localStorage.getItem(CART_KEY)); } catch { /* Storage is optional. */ }
  let fulfillment = 'delivery';
  let draft = null;
  let editIndex = -1;
  let receipt = null;
  let progress = 0;
  let paymentTimer;
  let paymentPhase = 'ready';
  let paymentSnapshot = null;
  const customer = { name: '', phone: '', email: '', address: '', note: '', payment: 'card' };

  function saveCart() {
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
  function setAddress(value) { customer.address = value; fulfillment = 'delivery'; updateBadge(); }
  function openProduct(id, index = -1, size = 30) {
    const item = getItem(data, id);
    if (!item) return;
    if (item.categoryId === 'baleni') { toast('Krabice se do košíku připočítá automaticky ke každé pizze.'); return; }
    editIndex = index;
    draft = normalizeLine(data, index >= 0 ? cart[index] : { itemId: id, size, quantity: 1, extras: [] });
    cartDialog.close();
    renderProduct();
    openDialog(productDialog);
  }
  function addonOptions(categoryId) {
    return (data.categories.find(c => c.id === categoryId)?.items || []).map(item => `<label class="addon-option"><input type="checkbox" data-addon="${item.id}" ${draft.extras.includes(item.id) ? 'checked' : ''}><span>${esc(name(item))}</span><strong data-addon-price="${item.id}">+${money(itemPrice(item, draft.size))}</strong></label>`).join('');
  }
  function renderProduct() {
    const item = getItem(data, draft.itemId);
    const pizza = item.categoryId === 'pizzy';
    $('#product-content').innerHTML = `<div class="customize-layout ${item.image ? '' : 'customize-no-photo'}">${item.image ? `<aside class="customize-photo"><img src="./${item.image}" alt="${esc(name(item))}"><span class="customize-photo-label">${pizza ? 'PO TVÉM CHUTNÁ NEJLÍP.' : 'NĚCO DOBRÉHO NAVÍC.'}</span></aside>` : ''}<div class="customize-copy"><p class="eyebrow">${pizza ? 'TVŮJ KOUSEK ŠTĚSTÍ' : 'DOPLŇ SVOJI OBJEDNÁVKU'}</p><h2 id="product-title">${esc(name(item))}</h2>${item.description ? `<p class="product-description">${esc(item.description)}</p>` : ''}${item.prices.length ? `<fieldset class="customize-size"><legend>Jak velký máš hlad?</legend><div class="product-sizes"><button data-option-size="30" aria-pressed="${draft.size === 30}">30 cm <span>${money(itemPrice(item, 30))}</span></button><button data-option-size="40" aria-pressed="${draft.size === 40}">40 cm <span>${money(itemPrice(item, 40))}</span></button></div></fieldset>` : `<p class="product-single-price">${money(itemPrice(item))}</p>`}${pizza ? `<div class="customize-extras"><details open><summary>Suroviny navíc <span>Podle tvé chuti ${icon('chev')}</span></summary><div class="addon-grid">${addonOptions('dej-si-navic')}</div></details><details open><summary>Něco do okrajů ${icon('chev')}</summary><div class="addon-grid addon-grid-single">${addonOptions('chutne-okraje')}</div></details><details><summary>Omáčka k pizze ${icon('chev')}</summary><div class="addon-grid addon-grid-single">${addonOptions('omacky')}</div></details></div>` : ''}<label class="customize-note">Poznámka k ${pizza ? 'pizze' : 'položce'} <span>nepovinné</span><textarea id="product-note" rows="2" maxlength="180" placeholder="Např. prosím rozkrájet…">${esc(draft.note)}</textarea></label><p class="customize-fine">${pizza ? 'Krabici připočítáme v košíku podle velikosti pizzy. ' : ''}Informace o alergenech ti sdělí pobočka.</p></div></div><div class="customize-footer"><div id="product-quantity">${stepper(draft.quantity, 'draft', name(item))}</div><button class="button" data-add-cart><span>${editIndex >= 0 ? 'Uložit úpravy' : 'Přidat do košíku'}</span><strong id="product-total">${money(unitPrice(data, draft) * draft.quantity)}</strong>${icon('arrow')}</button></div>`;
  }
  function updateProductPrice() {
    const item = getItem(data, draft.itemId);
    $$('[data-option-size]', productDialog).forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.optionSize) === draft.size)));
    $$('[data-addon-price]', productDialog).forEach(label => { label.textContent = '+' + money(itemPrice(getItem(data, label.dataset.addonPrice), draft.size)); });
    $('#product-total').textContent = money(unitPrice(data, draft) * draft.quantity);
    $('#product-quantity').innerHTML = stepper(draft.quantity, 'draft', name(item));
  }
  function addDraft() {
    if (!draft) return;
    const line = normalizeLine(data, draft);
    cart = mergeLine(cart, line, editIndex);
    saveCart();
    productDialog.close();
    draft = null;
    openCart();
  }
  function fulfillmentControls() {
    return `<div class="fulfillment-options" role="group" aria-label="Způsob převzetí"><button type="button" data-fulfillment="delivery" aria-pressed="${fulfillment === 'delivery'}">${icon('truck')}<span>Doručení<small>${money(data.delivery.price_czk)} · 30–90 min</small></span></button><button type="button" data-fulfillment="pickup" aria-pressed="${fulfillment === 'pickup'}">${icon('bag')}<span>Vyzvednutí<small>Zdarma · 10–30 min</small></span></button></div>`;
  }
  function summaryRows(total) {
    return `<dl class="price-summary"><div><dt>Jídlo a přísady</dt><dd>${money(total.subtotal)}</dd></div><div><dt>Krabice na pizzu</dt><dd>${money(total.packaging)}</dd></div><div><dt>${fulfillment === 'delivery' ? 'Rozvoz' : 'Osobní vyzvednutí'}</dt><dd>${total.delivery ? money(total.delivery) : 'Zdarma'}</dd></div><div class="price-total"><dt>Celkem</dt><dd>${money(total.total)}</dd></div></dl>`;
  }
  function cartLine(line, index) {
    const item = getItem(data, line.itemId);
    return `<article class="cart-line">${item.image ? `<img class="cart-line-image" src="./${item.image}" alt="${esc(name(item))}">` : `<span class="cart-line-image cart-line-symbol">${icon('bag')}</span>`}<div class="cart-line-copy"><div class="cart-line-title"><h3>${esc(name(item))}</h3><strong>${money(unitPrice(data, line) * line.quantity)}</strong></div><p>${line.size ? `${line.size} cm` : '1 porce / balení'}${line.extras.length ? ` · + ${line.extras.map(id => esc(name(getItem(data, id)))).join(', ')}` : ''}</p>${line.note ? `<p class="cart-line-note">${esc(line.note)}</p>` : ''}<div class="cart-line-actions">${stepper(line.quantity, String(index), name(item))}<button class="cart-edit" data-edit-line="${index}">Upravit</button><button class="cart-remove" data-remove-line="${index}" aria-label="Odebrat ${esc(name(item))}">${icon('close')}</button></div></div></article>`;
  }
  function openCart() {
    renderCart();
    openDialog(cartDialog);
  }
  function renderCart() {
    const branch = getBranch();
    const total = totals();
    $('#cart-content').innerHTML = `<header class="cart-heading"><p class="eyebrow">DOBRÝ VEČER ZAČÍNÁ TADY</p><h2 id="cart-title">TVŮJ <em>KOŠÍK.</em> <span>${total.quantity}</span></h2>${closeButton('Zavřít košík')}</header><div class="order-demo-note">${demoNotice}</div>${!cart.length ? `<div class="empty-cart">${icon('cart')}<h3>ZATÍM ANI KOUSEK.</h3><p>Vyber si pizzu, přidej něco navíc<br>a udělej si hezký den.</p><button class="button" data-continue-menu>Vybrat si pizzu ${icon('arrow')}</button>${receipt ? '<button class="small-text-button last-receipt" data-last-receipt>Poslední demo objednávka ↗</button>' : ''}</div>` : `<div class="cart-body"><div class="cart-branch"><span>${icon('pin')} ${branch ? `Pizza Visi ${esc(branch.name)}` : 'Vyber pobočku'}</span><button data-cart-branch>${branch ? 'Změnit' : 'Vybrat'} ↗</button></div>${fulfillmentControls()}<div class="cart-lines">${cart.map(cartLine).join('')}</div><div class="cart-upsell"><span>Ještě něco na zapití?</span><button data-quick-drink="coca-cola-0-5l">Coca-Cola · 50 Kč ${icon('plus')}</button></div></div><footer class="cart-footer">${summaryRows(total)}<p class="cart-packaging-note">Krabice: 30 cm / 16 Kč · 40 cm / 23 Kč. Časy jsou orientační.</p><button class="button cart-checkout" data-checkout>Pokračovat k objednávce ${icon('arrow')}</button><button class="cart-continue" data-close-dialog>Ještě něco přihodím</button></footer>`}`;
  }
  function requestBranch(resume) {
    cartDialog.close();
    checkoutDialog.close();
    chooseBranch(resume);
  }
  function openCheckout() {
    if (!cart.length) return openCart();
    if (!getBranch()) return requestBranch(openCheckout);
    cartDialog.close();
    paymentPhase = 'ready';
    renderCheckout();
    openDialog(checkoutDialog);
  }
  function captureCustomer() {
    const form = $('#checkout-form');
    if (!form) return;
    for (const key of ['name', 'phone', 'email', 'address', 'note']) {
      const field = form.elements.namedItem(key);
      if (field) customer[key] = field.value;
    }
    customer.payment = form.elements.namedItem('payment').value;
  }
  function checkoutHeader(step) {
    return `<div class="checkout-top"><a class="wordmark" href="#" tabindex="-1" aria-label="Pizza Visi">PIZZA <span>VISI</span><i aria-hidden="true"></i></a>${closeButton('Zavřít objednávku')}<div class="checkout-steps" aria-label="Průběh objednávky"><span>01 Košík</span><i></i><span ${step === 2 ? 'aria-current="step"' : ''}>02 Doručení</span><i></i><span ${step === 3 ? 'aria-current="step"' : ''}>03 Platba</span></div></div>`;
  }
  function renderCheckout() {
    const branch = getBranch();
    $('#checkout-content').innerHTML = `${checkoutHeader(2)}<div class="checkout-heading"><p class="eyebrow">UŽ JEN KOUSEK K DOBRÉ PIZZE</p><h2 id="checkout-title">KAM TO <em>BUDE?</em></h2><div class="order-demo-note">${demoNotice}</div></div><div class="checkout-layout"><form id="checkout-form"><div class="checkout-form-heading"><h3>1. PŘEVZETÍ</h3><button type="button" class="small-text-button" data-demo-fill>Vyplnit demo údaje ↗</button></div>${fulfillmentControls()}<div class="checkout-branch">${icon('pin')}<span><strong>Pizza Visi ${esc(branch.name)}</strong><small>${esc(branch.address)}</small></span></div>${fulfillment === 'delivery' ? `<label class="checkout-field">Doručovací adresa<input name="address" id="checkout-address" autocomplete="street-address" required minlength="4" maxlength="200" placeholder="Ulice a číslo, město" value="${esc(customer.address)}" aria-describedby="checkout-address-help"></label><p id="checkout-address-help" class="checkout-help">V demu vybíráme pobočku podle města. Přesnou adresu neověřujeme.</p>` : '<p class="checkout-help">Demo vyzvednutí na zvolené pobočce. Orientačně za 10–30 minut.</p>'}<h3 class="checkout-section-title">2. KONTAKT</h3><div class="checkout-field-grid"><label class="checkout-field">Jméno<input name="name" autocomplete="name" required minlength="2" maxlength="70" placeholder="Tvoje jméno" value="${esc(customer.name)}"></label><label class="checkout-field">Telefon<input name="phone" type="tel" autocomplete="tel" required maxlength="20" placeholder="777 000 000" value="${esc(customer.phone)}"></label></div><label class="checkout-field">E-mail <span>nepovinný</span><input name="email" type="email" autocomplete="email" maxlength="120" placeholder="demo@example.com" value="${esc(customer.email)}"></label><label class="checkout-field">Poznámka <span>nepovinná</span><textarea name="note" rows="2" maxlength="250" placeholder="Např. zvonek nebo patro…">${esc(customer.note)}</textarea></label><h3 class="checkout-section-title">3. PLATBA</h3><div class="payment-options"><label><input type="radio" name="payment" value="card" ${customer.payment === 'card' ? 'checked' : ''}>${icon('card')}<span>Kartou online<small>Simulovaná platební brána</small></span></label><label><input type="radio" name="payment" value="cash" ${customer.payment === 'cash' ? 'checked' : ''}>${icon('bag')}<span>Hotově při převzetí<small>Také pouze demo</small></span></label></div><p id="checkout-error" class="checkout-error" role="alert"></p><button class="button checkout-submit" type="submit">${customer.payment === 'card' ? 'Přejít na demo platbu' : 'Dokončit demo objednávku'} ${icon('arrow')}</button><button class="checkout-back" type="button" data-back-cart>← Zpět do košíku</button></form><aside class="checkout-summary"><p class="eyebrow">TVŮJ VÝBĚR</p><h3>VŠECHNO DOBRÉ<br>NA JEDNOM <em>MÍSTĚ.</em></h3><div class="checkout-mini-lines">${cart.map(line => { const item = getItem(data, line.itemId); return `<div><span><strong>${line.quantity}× ${esc(name(item))}</strong><small>${line.size ? line.size + ' cm' : ''}${line.extras.length ? ' · ' + line.extras.map(id => esc(name(getItem(data, id)))).join(', ') : ''}</small></span><b>${money(unitPrice(data, line) * line.quantity)}</b></div>`; }).join('')}</div>${summaryRows(totals())}<p class="checkout-help">Demo objednávka. Restaurace ji neobdrží a žádná částka se nestrhne.</p></aside></div>`;
  }
  function submitCheckout() {
    captureCustomer();
    const error = $('#checkout-error');
    if (customer.name.trim().length < 2) { error.textContent = 'Doplň prosím jméno.'; return; }
    if (!/^\+?[\d\s()-]+$/.test(customer.phone.trim()) || !/^\d{9,15}$/.test(customer.phone.replace(/\D/g, ''))) { error.textContent = 'Zadej platný telefon, nebo použij demo údaje.'; return; }
    if (fulfillment === 'delivery') {
      const match = matchDeliveryBranch(customer.address, data.branches);
      if (match.status === 'unknown' || match.status === 'empty') { error.textContent = 'Doplň adresu včetně města z našeho rozvozového okruhu, nebo použij demo údaje.'; return; }
      if (match.status === 'ambiguous' && !match.branchIds.includes(getBranch().id)) { error.textContent = 'Lokalita má více poboček. Vrať se do košíku a vyber Rudnou nebo Hostivice.'; return; }
      if (match.status === 'matched' && match.branchIds[0] !== getBranch().id) setBranch(match.branchIds[0]);
    }
    paymentSnapshot = { lines: cart.map(line => ({ ...line, extras: [...line.extras] })), total: totals(), branch: { ...getBranch() }, customer: { ...customer }, fulfillment };
    if (customer.payment === 'cash') finishOrder('cash');
    else { paymentPhase = 'ready'; renderPayment(); checkoutDialog.scrollTop = 0; }
  }
  function renderPayment() {
    const failed = paymentPhase === 'failed';
    const processing = paymentPhase === 'processing';
    $('#checkout-content').innerHTML = `${checkoutHeader(3)}<div class="demo-payment"><div class="order-demo-note">${demoNotice}</div><p class="eyebrow">PIZZA VISI · TESTOVACÍ PLATBA</p><h2 id="checkout-title">${processing ? 'OVĚŘUJEME <em>PLATBU.</em>' : failed ? 'ZKUSÍME TO <em>ZNOVU?</em>' : 'POSLEDNÍ <em>KOUSEK.</em>'}</h2><p class="payment-amount">${money(paymentSnapshot.total.total)}</p><div class="demo-credit-card"><div><span>VISI / DEMO PAY</span>${icon('card')}</div><span class="demo-card-number">4242 &nbsp;4242 &nbsp;4242 &nbsp;4242</span><div><span>TESTOVACÍ KARTA</span><span>12 / 30</span></div></div><p class="payment-instruction">Karta je pouze ukázková. Skutečné platební údaje se nezadávají.</p><div class="payment-status ${failed ? 'failed' : ''}" role="status" aria-live="polite">${processing ? '<span class="payment-spinner"></span> Simulujeme zpracování platby…' : failed ? 'Demo: platba byla zamítnuta. Košík zůstává uložený.' : `Vyzkoušej průchod platbou pro pobočku ${esc(paymentSnapshot.branch.name)}.`}</div><button class="button payment-success-button" data-pay-success ${processing ? 'disabled' : ''}>${failed ? 'Zkusit znovu – úspěšná platba' : 'Simulovat úspěšnou platbu'} ${icon('check')}</button><button class="button button-outline" data-pay-fail ${processing ? 'disabled' : ''}>Simulovat zamítnutí</button><button class="checkout-back" data-back-checkout ${processing ? 'disabled' : ''}>← Zpět k údajům a způsobu platby</button></div>`;
  }
  function simulatePayment(success) {
    if (!paymentSnapshot || paymentPhase === 'processing') return;
    paymentPhase = 'processing';
    renderPayment();
    paymentTimer = setTimeout(() => {
      if (!checkoutDialog.open) return;
      if (success) finishOrder('card');
      else { paymentPhase = 'failed'; renderPayment(); $('.payment-success-button').focus(); }
    }, 950);
  }
  function finishOrder(payment) {
    receipt = { ...paymentSnapshot, payment, id: 'DEMO-' + crypto.randomUUID().slice(0, 6).toUpperCase() };
    cart = [];
    saveCart();
    paymentSnapshot = null;
    paymentPhase = 'complete';
    progress = 0;
    renderReceipt();
    checkoutDialog.scrollTop = 0;
    $('#checkout-title').focus();
  }
  function renderReceipt() {
    const delivery = receipt.fulfillment === 'delivery';
    const steps = delivery ? ['Přijato', 'Pečeme', 'Na cestě', 'Doručeno'] : ['Přijato', 'Pečeme', 'K vyzvednutí', 'Vyzvednuto'];
    $('#checkout-content').innerHTML = `<div class="receipt-view">${closeButton('Zavřít potvrzení')}<span class="receipt-check">${icon('check')}</span><p class="eyebrow">${esc(receipt.id)} · DEMO OBJEDNÁVKA</p><h2 id="checkout-title" tabindex="-1">${progress === 3 ? 'TAK DOBROU <em>CHUŤ!</em>' : 'A JE <em>OBJEDNÁNO.</em>'}</h2><p class="receipt-intro">${receipt.payment === 'card' ? 'Simulovaná platba proběhla úspěšně.' : 'Vybraná platba: hotově při převzetí.'}<br>Nic se neplatilo a restaurace objednávku neobdržela.</p><div class="receipt-status"><div class="receipt-status-top"><span>PRŮBĚH SIMULACE</span><strong>${steps[progress]}</strong></div><ol class="order-timeline">${steps.map((step, index) => `<li class="${index <= progress ? 'done' : ''}" ${index === progress ? 'aria-current="step"' : ''}><span>${index < progress ? '✓' : index + 1}</span>${step}</li>`).join('')}</ol>${progress < 3 ? `<button class="small-text-button" data-order-advance>Posunout demo: ${steps[progress + 1]} ${icon('arrow')}</button>` : '<p class="demo-finished">Demo dokončeno. V reálu by tu už voněla pizza.</p>'}</div><div class="receipt-details"><div><span>POBOČKA</span><strong>Pizza Visi ${esc(receipt.branch.name)}</strong></div><div><span>${delivery ? 'DORUČENÍ' : 'VYZVEDNUTÍ'}</span><strong>${esc(delivery ? receipt.customer.address : receipt.branch.address)}</strong></div><div><span>PLATBA</span><strong>${receipt.payment === 'card' ? 'Kartou · demo zaplaceno' : 'Hotově · demo při převzetí'}</strong></div><div><span>CELKEM V DEMU</span><strong>${money(receipt.total.total)}</strong></div></div><details class="receipt-items"><summary>Zobrazit objednávku (${receipt.total.quantity} ks)</summary>${receipt.lines.map(line => `<p><span>${line.quantity}× ${esc(name(getItem(data, line.itemId)))} ${line.size ? '· ' + line.size + ' cm' : ''}${line.extras.length ? '<small>+ ' + line.extras.map(id => esc(name(getItem(data, id)))).join(', ') + '</small>' : ''}${line.note ? `<small>${esc(line.note)}</small>` : ''}</span><strong>${money(unitPrice(data, line) * line.quantity)}</strong></p>`).join('')}<p><span>Krabice</span><strong>${money(receipt.total.packaging)}</strong></p><p><span>${delivery ? 'Rozvoz' : 'Vyzvednutí'}</span><strong>${money(receipt.total.delivery)}</strong></p></details><button class="button" data-continue-menu>Zpět na menu ${icon('arrow')}</button></div>`;
  }

  document.addEventListener('click', event => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.hasAttribute('data-open-cart')) openCart();
    if (target.dataset.optionSize && draft) { draft.size = Number(target.dataset.optionSize); updateProductPrice(); }
    if (target.hasAttribute('data-add-cart')) addDraft();
    if (target.hasAttribute('data-quantity')) {
      const delta = Number(target.dataset.delta);
      if (target.dataset.quantity === 'draft' && draft) {
        draft.quantity = Math.max(1, Math.min(MAX_QUANTITY, draft.quantity + delta));
        updateProductPrice();
        $(`[data-quantity="draft"][data-delta="${delta}"]`).focus();
      } else {
        const index = Number(target.dataset.quantity);
        if (!cart[index]) return;
        cart[index].quantity = Math.max(1, Math.min(MAX_QUANTITY, cart[index].quantity + delta));
        saveCart(); renderCart();
        $(`[data-quantity="${index}"][data-delta="${delta}"]`).focus();
      }
    }
    if (target.hasAttribute('data-remove-line')) { cart.splice(Number(target.dataset.removeLine), 1); saveCart(); renderCart(); }
    if (target.hasAttribute('data-edit-line')) { const index = Number(target.dataset.editLine); openProduct(cart[index].itemId, index); }
    if (target.dataset.fulfillment) {
      captureCustomer(); fulfillment = target.dataset.fulfillment; updateBadge();
      if (cartDialog.open) renderCart(); else renderCheckout();
      $(`[data-fulfillment="${fulfillment}"]`, cartDialog.open ? cartDialog : checkoutDialog).focus();
    }
    if (target.dataset.quickDrink) { cart = mergeLine(cart, normalizeLine(data, { itemId: target.dataset.quickDrink, quantity: 1 })); saveCart(); renderCart(); }
    if (target.hasAttribute('data-cart-branch')) requestBranch(openCart);
    if (target.hasAttribute('data-checkout')) openCheckout();
    if (target.hasAttribute('data-back-cart')) { captureCustomer(); checkoutDialog.close(); openCart(); }
    if (target.hasAttribute('data-demo-fill')) {
      Object.assign(customer, { name: 'Demo zákazník', phone: '777 000 000', email: 'demo@example.com', address: getBranch().address });
      renderCheckout(); $('#checkout-form input[name="name"]').focus();
    }
    if (target.hasAttribute('data-pay-success')) simulatePayment(true);
    if (target.hasAttribute('data-pay-fail')) simulatePayment(false);
    if (target.hasAttribute('data-back-checkout')) { paymentPhase = 'ready'; renderCheckout(); }
    if (target.hasAttribute('data-order-advance') && receipt) { progress = Math.min(3, progress + 1); renderReceipt(); }
    if (target.hasAttribute('data-last-receipt') && receipt) { cartDialog.close(); renderReceipt(); openDialog(checkoutDialog); }
    if (target.hasAttribute('data-continue-menu')) {
      cartDialog.close(); checkoutDialog.close();
      $('#menu').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
  });
  productDialog.addEventListener('change', event => {
    if (event.target.dataset.addon && draft) {
      const selected = new Set(draft.extras);
      if (event.target.checked) selected.add(event.target.dataset.addon); else selected.delete(event.target.dataset.addon);
      draft.extras = [...selected].sort(); updateProductPrice();
    }
  });
  productDialog.addEventListener('input', event => { if (event.target.id === 'product-note' && draft) draft.note = event.target.value; });
  checkoutDialog.addEventListener('input', captureCustomer);
  checkoutDialog.addEventListener('change', event => {
    captureCustomer();
    if (event.target.name === 'payment') $('.checkout-submit').innerHTML = `${customer.payment === 'card' ? 'Přejít na demo platbu' : 'Dokončit demo objednávku'} ${icon('arrow')}`;
  });
  checkoutDialog.addEventListener('submit', event => { if (event.target.id === 'checkout-form') { event.preventDefault(); submitCheckout(); } });
  checkoutDialog.addEventListener('close', () => { clearTimeout(paymentTimer); if (paymentPhase === 'processing') paymentPhase = 'ready'; });
  updateBadge();
  return { openProduct: (id, size) => openProduct(id, -1, size), openCart, setAddress, branchChanged: () => { if (cartDialog.open) renderCart(); } };
}
