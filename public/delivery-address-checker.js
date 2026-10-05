import { loadRuianAddresses, resolveAddress, searchAddresses } from './ruian-addresses.js?v=coverage-20261005-v2';
import { bindAddressSuggestionEvents } from './address-suggestion-events.js?v=2';

const mountedCheckers = new WeakMap();
const INPUT_ID = 'delivery-coverage-address';
const RESULTS_ID = `${INPUT_ID}-results`;
const STATUS_ID = `${INPUT_ID}-status`;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);
const pin = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>';
const check = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';

/** Homepage-only lookup. Only a canonical suggestion can confirm coverage. */
export function initDeliveryAddressChecker(container, branches, { onSelect = () => {} } = {}) {
  if (!container) return () => {};
  if (mountedCheckers.has(container)) return mountedCheckers.get(container);
  const branchById = new Map(branches.map(branch => [branch.id, branch]));
  let data;
  let matches = [];
  let activeIndex = -1;
  let selected = null;
  let revision = 0;
  let destroyed = false;
  const listeners = [];

  container.classList.add('delivery-address-checker');
  container.innerHTML = `
    <div class="delivery-address-intro">
      <h3>Rozvážíme <em>až k vám?</em></h3>
    </div>
    <form class="delivery-address-form" novalidate>
      <label class="sr-only" for="${INPUT_ID}">Kam ti máme přivézt pizzu?</label>
      <div class="delivery-address-row">
        <div class="address-combobox delivery-address-combobox">
          <div class="delivery-address-input-wrap">
            ${pin}
            <input id="${INPUT_ID}" name="delivery-coverage-address" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${RESULTS_ID}" aria-describedby="${STATUS_ID}" autocomplete="off" autocapitalize="words" spellcheck="false" maxlength="160" placeholder="Ulice, číslo domu, město">
            <button class="delivery-address-clear" type="button" aria-label="Vymazat adresu" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg></button>
          </div>
          <ul id="${RESULTS_ID}" class="delivery-address-options" role="listbox" aria-label="Nalezené adresy" hidden></ul>
        </div>
        <button class="delivery-address-submit" type="submit"><span>Ověřit<span class="delivery-address-submit-detail"> adresu</span></span><span class="delivery-address-submit-arrow" aria-hidden="true">→</span></button>
      </div>
      <p id="${STATUS_ID}" class="delivery-address-status" role="status" aria-live="polite" aria-atomic="true">Začni psát a vyber přesnou adresu z nabídky.</p>
      <button class="delivery-address-retry" type="button" hidden>Zkusit načíst adresy znovu</button>
      <p class="delivery-address-contact" hidden>Nemůžeš adresu najít? <a href="#pobocky">Zavolej na pobočku</a> nebo si pizzu vyzvedni osobně.</p>
      <div class="delivery-address-result" role="status" aria-live="polite" aria-atomic="true" hidden></div>
    </form>`;

  const input = container.querySelector(`#${INPUT_ID}`);
  const list = container.querySelector(`#${RESULTS_ID}`);
  const status = container.querySelector(`#${STATUS_ID}`);
  const form = container.querySelector('.delivery-address-form');
  const clearButton = container.querySelector('.delivery-address-clear');
  const retryButton = container.querySelector('.delivery-address-retry');
  const contact = container.querySelector('.delivery-address-contact');
  const result = container.querySelector('.delivery-address-result');

  function listen(target, type, handler) {
    target.addEventListener(type, handler);
    listeners.push(() => target.removeEventListener(type, handler));
  }
  function showStatus(message) {
    status.hidden = false;
    status.textContent = message;
  }
  function hideList() {
    list.hidden = true;
    list.innerHTML = '';
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    activeIndex = -1;
    matches = [];
  }
  function close() {
    revision += 1;
    hideList();
    input.removeAttribute('aria-busy');
    if (!selected && !retryButton.hidden) return;
    if (!selected && !contact.hidden) return;
    if (!selected) showStatus(input.value.trim().length >= 3
      ? 'Pro ověření vyber přesnou adresu z nabídky.'
      : 'Začni psát a vyber přesnou adresu z nabídky.');
  }
  function invalidate() {
    selected = null;
    result.hidden = true;
    result.innerHTML = '';
    contact.hidden = true;
    retryButton.hidden = true;
    clearButton.hidden = !input.value;
    onSelect(null);
  }
  function activate(index) {
    if (!matches.length) return;
    activeIndex = (index + matches.length) % matches.length;
    const options = list.querySelectorAll('[role="option"]');
    options.forEach((option, position) => option.setAttribute('aria-selected', String(position === activeIndex)));
    input.setAttribute('aria-activedescendant', options[activeIndex].id);
    options[activeIndex].scrollIntoView({ block: 'nearest' });
  }
  function select(id, { pointerType } = {}) {
    if (destroyed || !data || !matches.some(address => address.id === id)) return;
    const address = resolveAddress(data, id);
    if (!address) return;
    const servingBranches = address.branchIds.map(branchId => branchById.get(branchId)).filter(Boolean);
    if (!servingBranches.length) return;
    revision += 1;
    selected = address;
    input.value = address.label;
    input.removeAttribute('aria-busy');
    clearButton.hidden = false;
    hideList();
    status.textContent = '';
    status.hidden = true;
    retryButton.hidden = true;
    contact.hidden = true;
    result.innerHTML = `<span class="delivery-address-success-mark">${check}</span>
      <div><strong>Ano, sem rozvážíme.</strong><p class="delivery-address-confirmed">${escapeHtml(address.label)}</p>
      <p class="delivery-address-serving">${servingBranches.length > 1 ? 'Rozváží sem pobočky' : 'Přiveze pobočka'} <b>${servingBranches.map(branch => escapeHtml(branch.name)).join(' a ')}</b>.</p>
      <a class="delivery-address-menu" href="#menu">Vybrat pizzu <span aria-hidden="true">→</span></a></div>`;
    result.hidden = false;
    onSelect(address);
    if (pointerType === 'touch' || pointerType === 'pen') input.blur();
  }

  async function refresh() {
    const request = ++revision;
    const query = input.value.trim();
    hideList();
    retryButton.hidden = true;
    contact.hidden = true;
    if (!data) {
      input.setAttribute('aria-busy', 'true');
      showStatus('Načítáme adresy…');
      try {
        data = await loadRuianAddresses();
      } catch {
        if (destroyed || request !== revision) return;
        input.removeAttribute('aria-busy');
        showStatus('Adresář se nepodařilo načíst. Zkus to prosím znovu.');
        retryButton.hidden = false;
        contact.hidden = false;
        return;
      }
    }
    if (destroyed || request !== revision) return;
    input.removeAttribute('aria-busy');
    if (query.length < 3) {
      showStatus(query ? 'Napiš alespoň 3 znaky, například ulici a číslo domu.' : 'Začni psát a vyber přesnou adresu z nabídky.');
      return;
    }
    matches = searchAddresses(data, query, 8);
    if (!matches.length) {
      showStatus('Adresu se nepodařilo ověřit. Zkus ulici, číslo domu a město.');
      contact.hidden = false;
      return;
    }
    list.innerHTML = matches.map(address => `<li id="${INPUT_ID}-option-${address.id}" role="option" aria-selected="false" data-address-id="${escapeHtml(address.id)}"><span>${escapeHtml(address.label)}</span><small>${address.branchIds.map(id => escapeHtml(branchById.get(id)?.name || '')).filter(Boolean).join(' / ')}</small></li>`).join('');
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    showStatus('Vyber přesnou adresu z nabídky. Můžeš použít šipky a Enter.');
  }

  listen(input, 'focus', () => { if (!selected) void refresh(); });
  listen(input, 'input', () => { invalidate(); void refresh(); });
  listen(input, 'keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (list.hidden) { if (!selected) void refresh(); }
      else activate(activeIndex < 0 ? (event.key === 'ArrowDown' ? 0 : matches.length - 1) : activeIndex + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Enter' && !list.hidden && activeIndex >= 0) {
      event.preventDefault();
      select(matches[activeIndex].id);
    } else if (event.key === 'Escape') {
      if (!list.hidden) event.preventDefault();
      close();
    } else if (event.key === 'Tab') close();
  });
  listen(form, 'submit', event => {
    event.preventDefault();
    if (selected) return;
    input.focus();
    void refresh();
  });
  listen(clearButton, 'click', () => {
    input.value = '';
    invalidate();
    close();
    input.focus();
  });
  listen(retryButton, 'click', event => {
    // This control sits outside the combobox. Its bubbling click must not
    // immediately cancel the new request in the suggestion close handler.
    event.stopPropagation();
    input.focus();
    void refresh();
  });
  const unbindSuggestions = bindAddressSuggestionEvents(container, { select, close, inputId: INPUT_ID });

  function cleanup() {
    if (destroyed) return;
    destroyed = true;
    revision += 1;
    listeners.forEach(remove => remove());
    unbindSuggestions?.();
    mountedCheckers.delete(container);
  }
  mountedCheckers.set(container, cleanup);
  return cleanup;
}
