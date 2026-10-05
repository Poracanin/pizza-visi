import { loadRuianAddresses, searchAddresses, resolveAddress } from './ruian-addresses.js?v=coverage-20261005';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const paths = {
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  truck: '<path d="M2 4h12v13H2zM14 9h4l4 4v4h-8"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="19" r="2"/>',
  bag: '<path d="M5 7h14l2 14H3L5 7Z"/><path d="M9 8V5a3 3 0 0 1 6 0v3"/>',
  pin: '<path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
};
const icon = name => `<svg class="delivery-choice-icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;

export function createDeliveryDialog({ data, getSelection, onApply, onClose }) {
  const dialog = document.createElement('dialog');
  dialog.id = 'delivery-choice-dialog';
  dialog.className = 'delivery-choice-dialog';
  dialog.setAttribute('aria-labelledby', 'delivery-choice-title');
  dialog.setAttribute('aria-describedby', 'delivery-choice-intro');
  document.body.append(dialog);
  const $ = selector => dialog.querySelector(selector);
  let addresses = null;
  let loading = false;
  let loadError = '';
  let draft;
  let initial = false;
  let busy = false;
  let results = [];
  let activeIndex = -1;
  let closeReason = 'dismissed';
  let panelAnimations = [];
  let panelTransition = 0;

  const branchFor = id => data.branches.find(branch => branch.id === id) || null;
  function canonicalAddress() {
    const address = addresses && draft.addressId ? resolveAddress(addresses, draft.addressId) : null;
    return address && address.label === draft.query ? address : null;
  }
  function assignAddress(address, assignBranch = true) {
    const allowed = address.branchIds.filter(id => branchFor(id));
    if (!allowed.length) return false;
    draft.addressId = address.id;
    draft.query = address.label;
    if (assignBranch && !allowed.includes(draft.branchId)) draft.branchId = allowed[0];
    return true;
  }
  function updateContinue() {
    const button = $('[data-choice-submit]');
    if (!button) return;
    const address = canonicalAddress();
    const valid = draft.fulfillment === 'pickup' ? Boolean(branchFor(draft.branchId)) : Boolean(address && address.branchIds.includes(draft.branchId));
    button.disabled = busy || !valid;
  }
  function setError(message = '') {
    const error = $('#delivery-choice-error');
    if (error) { error.textContent = message; error.hidden = !message; }
  }
  function addressStatus() {
    if (canonicalAddress()) return 'Adresu máme. Pobočku jsme vybrali podle místa doručení.';
    if (loading) return 'Načítáme doručovací adresy…';
    if (loadError) return 'Adresy se nepodařilo načíst. Zkus to znovu nebo zvol vyzvednutí.';
    return 'Napiš ulici, číslo domu a město. Pak vyber přesnou adresu z nabídky.';
  }
  function updateAddressSummary() {
    const summary = $('#delivery-choice-assignment');
    if (!summary) return;
    const address = canonicalAddress();
    const branch = address && branchFor(draft.branchId);
    summary.hidden = !branch;
    summary.innerHTML = branch ? `${icon('check')}<span>Připraví a přiveze <strong>Pizza Visi ${escape(branch.name)}</strong></span>` : '';
  }
  function closeSuggestions() {
    const input = $('#delivery-choice-address');
    if (input) { input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); }
    const list = $('#delivery-choice-results');
    if (list) list.hidden = true;
    activeIndex = -1;
  }
  function showSuggestions() {
    const input = $('#delivery-choice-address');
    if (!input || !addresses || busy) return;
    cancelPanelAnimation();
    results = searchAddresses(addresses, input.value, 6);
    activeIndex = -1;
    const list = $('#delivery-choice-results');
    list.innerHTML = results.map((address, index) => `<li id="delivery-choice-result-${index}" role="option" aria-selected="false" data-choice-address="${escape(address.id)}">${icon('pin')}<span>${escape(address.label)}</span></li>`).join('');
    list.hidden = !results.length;
    input.setAttribute('aria-expanded', String(Boolean(results.length)));
    input.removeAttribute('aria-activedescendant');
    $('#delivery-choice-address-status').textContent = results.length
      ? `${results.length} ${results.length === 1 ? 'adresa' : results.length < 5 ? 'adresy' : 'adres'} v nabídce. Vyber kliknutím nebo šipkami a Enterem.`
      : input.value.trim().length < 2 ? 'Napiš alespoň 2 znaky ulice nebo města.' : 'Adresu jsme nenašli. Zkus přidat ulici, číslo domu nebo město. Rozvážíme z Rudné, Hostivic a Berouna.';
  }
  function selectAddress(id) {
    if (busy || !addresses) return;
    const address = resolveAddress(addresses, id);
    if (!address || !assignAddress(address)) return;
    cancelPanelAnimation();
    $('#delivery-choice-address').value = address.label;
    closeSuggestions();
    $('#delivery-choice-address-status').textContent = addressStatus();
    updateAddressSummary();
    updateContinue();
    setError();
    $('#delivery-choice-address').focus({ preventScroll: true });
  }
  function focusOption(index) {
    activeIndex = index;
    const input = $('#delivery-choice-address');
    const list = $('#delivery-choice-results');
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-activedescendant', `delivery-choice-result-${index}`);
    list.querySelectorAll('[role="option"]').forEach((option, optionIndex) => option.setAttribute('aria-selected', String(optionIndex === index)));
    $(`#delivery-choice-result-${index}`).scrollIntoView({ block: 'nearest' });
  }
  function cancelPanelAnimation() {
    panelTransition += 1;
    panelAnimations.forEach(animation => animation.cancel());
    panelAnimations = [];
    $('.delivery-choice-panel')?.style.removeProperty('overflow');
  }
  function renderPanel({ animate = false } = {}) {
    const panel = $('.delivery-choice-panel');
    const previousHeight = panel.getBoundingClientRect().height;
    cancelPanelAnimation();
    results = []; activeIndex = -1;
    const delivery = draft.fulfillment === 'delivery';
    panel.innerHTML = `<div class="delivery-choice-panel-inner">${delivery ? `<div class="delivery-choice-address-field"><label class="delivery-choice-section-title" for="delivery-choice-address">Kam ti pizzu přivezeme?</label><div class="delivery-choice-combobox">${icon('pin')}<input id="delivery-choice-address" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="delivery-choice-results" aria-describedby="delivery-choice-address-status" autocomplete="off" maxlength="200" placeholder="Ulice, číslo domu, město" value="${escape(draft.query)}"><ul id="delivery-choice-results" class="delivery-choice-results" role="listbox" aria-label="Doručovací adresy" hidden></ul></div><p id="delivery-choice-address-status" class="delivery-choice-help" role="status">${escape(addressStatus())}</p><button type="button" class="delivery-choice-retry" data-choice-retry ${loadError ? '' : 'hidden'}>Načíst adresy znovu</button><div id="delivery-choice-assignment" class="delivery-choice-assignment" role="status" hidden></div></div>` : `<p id="delivery-choice-pickup-title" class="delivery-choice-section-title">Kde se potkáme?</p><div class="delivery-choice-pickup" role="group" aria-labelledby="delivery-choice-pickup-title">${data.branches.map(branch => `<button type="button" class="delivery-choice-branch" data-choice-branch="${escape(branch.id)}" aria-pressed="${draft.branchId === branch.id}"><span class="delivery-choice-branch-pin">${icon('pin')}</span><span><strong>${escape(branch.name)}</strong><small>${escape(branch.address)}</small></span><span class="delivery-choice-branch-check">${icon('check')}</span></button>`).join('')}</div>`}</div>`;
    updateAddressSummary();
    updateContinue();
    if (!animate || !dialog.open || window.matchMedia('(prefers-reduced-motion: reduce)').matches || typeof panel.animate !== 'function') return;
    const nextHeight = panel.getBoundingClientRect().height;
    const transition = panelTransition;
    panel.style.overflow = 'hidden';
    const options = { duration: 260, easing: 'cubic-bezier(.22,.7,.2,1)' };
    panelAnimations = [
      panel.animate([{ height: `${previousHeight}px` }, { height: `${nextHeight}px` }], options),
      $('.delivery-choice-panel-inner').animate([{ opacity: 0, transform: `translateY(${delivery ? -7 : 7}px)` }, { opacity: 1, transform: 'translateY(0)' }], options),
    ];
    Promise.all(panelAnimations.map(animation => animation.finished)).then(() => {
      if (transition !== panelTransition) return;
      panelAnimations = [];
      panel.style.removeProperty('overflow');
    }).catch(() => { /* A new mode, close, or address interaction cancelled this transition. */ });
  }
  function render() {
    cancelPanelAnimation();
    const delivery = draft.fulfillment === 'delivery';
    dialog.innerHTML = `<div class="delivery-choice-shell">
      <button type="button" class="delivery-choice-close" data-choice-close aria-label="Zavřít výběr doručení">${icon('close')}</button>
      <header class="delivery-choice-heading"><span class="delivery-choice-logo" aria-label="Pizza Visi">PIZZA <b>VISI</b></span><p class="delivery-choice-eyebrow">ČERSTVĚ Z NAŠÍ PECE</p><h2 id="delivery-choice-title" tabindex="-1">Kam to <em>bude?</em></h2><p id="delivery-choice-intro">${initial ? 'Přivezeme ji k tobě, nebo se stavíš?' : 'Změna plánů? Vyber, co ti vyhovuje.'}</p></header>
      <form class="delivery-choice-form" novalidate>
        <div class="delivery-choice-modes" data-mode="${draft.fulfillment}" role="group" aria-label="Způsob převzetí"><span class="delivery-choice-mode-indicator" aria-hidden="true"></span><button type="button" data-choice-mode="delivery" aria-pressed="${delivery}">${icon('truck')}<span><strong>Doručení</strong><small>Až ke dveřím</small></span></button><button type="button" data-choice-mode="pickup" aria-pressed="${!delivery}">${icon('bag')}<span><strong>Vyzvednutí</strong><small>Na pobočce</small></span></button></div>
        <div class="delivery-choice-panel"></div>
        <label class="delivery-choice-remember"><input type="checkbox" name="remember" ${draft.remember ? 'checked' : ''}><span>Zapamatovat pro příště<small>Výběr uložíme jen v tomto prohlížeči.</small></span></label>
        <p id="delivery-choice-error" class="delivery-choice-error" role="alert" hidden></p>
        <button class="delivery-choice-submit" type="submit" data-choice-submit>${initial ? 'Pokračovat na menu' : 'Uložit výběr'}${icon('arrow')}</button>
        <button class="delivery-choice-skip" type="button" data-choice-close>${initial ? 'Zatím jen prohlédnout menu' : 'Zrušit změny'}</button>
      </form>
    </div>`;
    renderPanel();
  }
  async function ensureAddresses() {
    if (addresses || loading) return;
    loading = true; loadError = '';
    if (dialog.open && draft.fulfillment === 'delivery') {
      $('#delivery-choice-address-status').textContent = addressStatus();
      $('[data-choice-retry]').hidden = true;
    }
    try {
      addresses = await loadRuianAddresses();
      const address = draft?.addressId && resolveAddress(addresses, draft.addressId);
      if (address) assignAddress(address, draft.fulfillment === 'delivery');
      else if (draft) draft.addressId = null;
    } catch (error) { loadError = error.message || 'Adresář není dostupný.'; }
    finally {
      loading = false;
      if (dialog.open && draft.fulfillment === 'delivery') {
        cancelPanelAnimation();
        const input = $('#delivery-choice-address');
        if (canonicalAddress()) input.value = draft.query;
        $('#delivery-choice-address-status').textContent = addressStatus();
        $('[data-choice-retry]').hidden = !loadError;
        updateAddressSummary(); updateContinue();
        if (document.activeElement === input && draft.query && !canonicalAddress()) showSuggestions();
      }
    }
  }
  function close(reason = 'dismissed') {
    if (busy || !dialog.open) return;
    closeReason = reason;
    cancelPanelAnimation();
    dialog.close();
  }
  async function apply() {
    if (busy) return;
    setError();
    const address = draft.fulfillment === 'delivery' ? canonicalAddress() : null;
    if (!branchFor(draft.branchId) || (draft.fulfillment === 'delivery' && (!address || !address.branchIds.includes(draft.branchId)))) {
      setError(draft.fulfillment === 'delivery' ? 'Vyber přesnou adresu z nabídky RÚIAN.' : 'Vyber pobočku pro vyzvednutí.');
      return;
    }
    const payload = { fulfillment: draft.fulfillment, branchId: draft.branchId, addressId: address?.id || null, address, remember: draft.remember };
    busy = true;
    cancelPanelAnimation();
    closeSuggestions();
    const form = $('.delivery-choice-form');
    form.inert = true;
    $('[data-choice-close]').disabled = true;
    dialog.setAttribute('aria-busy', 'true');
    const button = $('[data-choice-submit]');
    button.disabled = true; button.textContent = 'Ukládáme výběr…';
    try {
      await onApply(payload);
      busy = false;
      close('applied');
    } catch (error) {
      setError(error?.message || 'Výběr se nepodařilo uložit. Zkus to prosím znovu.');
    } finally {
      busy = false;
      form.inert = false;
      dialog.removeAttribute('aria-busy');
      $('[data-choice-close]').disabled = false;
      button.innerHTML = `${initial ? 'Pokračovat na menu' : 'Uložit výběr'}${icon('arrow')}`;
      updateContinue();
    }
  }

  dialog.addEventListener('submit', event => { event.preventDefault(); apply(); });
  dialog.addEventListener('click', event => {
    if (busy) return;
    const target = event.target.closest('button,[data-choice-address]');
    if (target?.hasAttribute('data-choice-close')) { close(); return; }
    if (target?.dataset.choiceMode) {
      if (draft.fulfillment === target.dataset.choiceMode) return;
      closeSuggestions();
      draft.fulfillment = target.dataset.choiceMode;
      if (draft.fulfillment === 'delivery') {
        const address = canonicalAddress();
        if (address) assignAddress(address);
      }
      $('.delivery-choice-modes').dataset.mode = draft.fulfillment;
      dialog.querySelectorAll('[data-choice-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.choiceMode === draft.fulfillment)));
      setError();
      renderPanel({ animate: true });
      target.focus({ preventScroll: true });
      if (draft.fulfillment === 'delivery') ensureAddresses();
      return;
    }
    if (target?.dataset.choiceBranch && branchFor(target.dataset.choiceBranch)) {
      draft.branchId = target.dataset.choiceBranch;
      dialog.querySelectorAll('[data-choice-branch]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.choiceBranch === draft.branchId)));
      updateContinue(); setError(); return;
    }
    if (target?.dataset.choiceAddress) { selectAddress(target.dataset.choiceAddress); return; }
    if (target?.hasAttribute('data-choice-retry')) { ensureAddresses(); return; }
    if (!event.target.closest('.delivery-choice-combobox')) closeSuggestions();
    if (event.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
    }
  });
  dialog.addEventListener('input', event => {
    if (busy || event.target.id !== 'delivery-choice-address') return;
    draft.query = event.target.value;
    draft.addressId = null;
    setError(); updateAddressSummary(); updateContinue(); showSuggestions();
  });
  dialog.addEventListener('change', event => { if (!busy && event.target.name === 'remember') draft.remember = event.target.checked; });
  dialog.addEventListener('focusin', event => { if (event.target.id === 'delivery-choice-address' && !canonicalAddress() && draft.query) showSuggestions(); });
  dialog.addEventListener('focusout', event => { if (event.target.id === 'delivery-choice-address') closeSuggestions(); });
  dialog.addEventListener('pointerdown', event => { if (event.target.closest('[data-choice-address]')) event.preventDefault(); });
  dialog.addEventListener('keydown', event => {
    if (busy || event.target.id !== 'delivery-choice-address') return;
    if (event.key === 'Escape' && event.target.getAttribute('aria-expanded') === 'true') { event.preventDefault(); event.stopPropagation(); closeSuggestions(); return; }
    if (event.key === 'Tab') { closeSuggestions(); return; }
    if (event.key === 'Enter' && activeIndex >= 0) { event.preventDefault(); selectAddress(results[activeIndex].id); return; }
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    if (!results.length) showSuggestions();
    if (!results.length) return;
    const next = activeIndex < 0 ? (event.key === 'ArrowDown' ? 0 : results.length - 1) : (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
    focusOption(next);
  });
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    cancelPanelAnimation();
    closeSuggestions();
    if (!document.querySelector('dialog[open]')) document.body.classList.remove('modal-open');
    onClose?.(closeReason);
    closeReason = 'dismissed';
  });

  return {
    open(options = {}) {
      if (busy) return;
      const current = getSelection?.() || {};
      initial = Boolean(options.initial);
      closeReason = 'dismissed';
      draft = {
        fulfillment: (options.fulfillment || current.fulfillment) === 'pickup' ? 'pickup' : 'delivery',
        branchId: branchFor(options.branchId || current.branchId)?.id || null,
        addressId: typeof current.addressId === 'string' ? current.addressId : null,
        query: typeof current.address === 'string' ? current.address : current.address?.label || '',
        remember: Boolean(current.remember),
      };
      if (addresses && draft.addressId) {
        const address = resolveAddress(addresses, draft.addressId);
        if (address) assignAddress(address, draft.fulfillment === 'delivery'); else draft.addressId = null;
      }
      render();
      if (!dialog.open) dialog.showModal();
      document.body.classList.add('modal-open');
      if (draft.fulfillment === 'delivery') ensureAddresses();
      $('#delivery-choice-title').focus({ preventScroll: true });
    },
    close: () => close(),
  };
}
