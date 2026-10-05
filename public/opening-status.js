import { storeOpeningStatus, countdownText, closedOrderingMessage } from './opening-hours.js?v=1';

export const ORDER_ACTIONS = '[data-quick-add], [data-add-cart], [data-quick-drink], [data-quick-sauce], [data-checkout], .checkout-submit, [data-quantity][data-delta="1"]';
export function updateOrderControls(status, submitting = false) {
  document.body.classList.toggle('ordering-closed', !status.isOpen);
  document.querySelectorAll(ORDER_ACTIONS).forEach(button => {
    button.disabled = !status.isOpen || submitting || button.dataset.quantityLimit === 'true';
    button.toggleAttribute('data-hours-blocked', !status.isOpen);
    if (!status.isOpen) button.setAttribute('title', closedOrderingMessage(status));
    else button.removeAttribute('title');
  });
  document.querySelectorAll('[data-closed-notice]').forEach(notice => {
    notice.hidden = status.isOpen;
    const message = closedOrderingMessage(status);
    if (notice.textContent !== message) notice.textContent = message;
  });
}
export function createOpeningStatus({ data, getBranchId, onChange }) {
  const strip = document.querySelector('#opening-status');
  const label = strip.querySelector('[data-opening-label]');
  const detail = strip.querySelector('[data-opening-detail]');
  const announcement = document.querySelector('#opening-announcement');
  let previous;
  function refresh() {
    const status = storeOpeningStatus(data, new Date(), getBranchId());
    const state = status.countdown || (status.isOpen ? 'open' : 'closed');
    strip.dataset.state = state;
    label.textContent = status.isOpen ? 'Máme otevřeno' : 'Máme zavřeno';
    const text = status.countdown ? `${status.isOpen ? 'Zavíráme' : 'Otevíráme'} za ${countdownText(status.secondsRemaining)}` : status.detail;
    if (detail.textContent !== text) detail.textContent = text;
    const key = `${status.isOpen}:${status.detail}`;
    if (key !== previous) {
      previous = key;
      announcement.textContent = `${label.textContent}. ${status.detail}.`;
      onChange(status);
    }
    return status;
  }
  refresh();
  setInterval(refresh, 1000);
  window.addEventListener('focus', refresh);
  window.addEventListener('pageshow', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  return { refresh };
}
