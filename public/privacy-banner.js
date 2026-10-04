/** The app owns consent persistence; this widget never reads or writes storage. */
export function createPrivacyBanner({ getPreferenceConsent, onDecision }) {
  const banner = document.createElement('aside');
  banner.id = 'privacy-banner';
  banner.className = 'privacy-banner';
  banner.hidden = true;
  banner.tabIndex = -1;
  banner.setAttribute('aria-labelledby', 'privacy-banner-title');
  banner.innerHTML = `<div class="privacy-banner-copy"><h2 id="privacy-banner-title">Cookies a uložené volby</h2><p>Košík potřebuje nezbytné uložení. Přesnou adresu si pro příště zapamatujeme jen s tvým svolením.</p></div><div class="privacy-banner-actions"><button type="button" data-privacy-decision="accepted">Přijmout</button><button type="button" data-privacy-decision="essential">Jen nezbytné</button></div>`;
  document.body.append(banner);

  let intent = null;
  let touchY = null;
  let decidedHere = false;
  let returnFocus = null;
  const dialogOpen = () => Boolean(document.querySelector('dialog[open]'));
  const clearIntent = () => { intent = null; touchY = null; };
  const canPrompt = () => !decidedHere && getPreferenceConsent() === null;

  function hide() {
    banner.hidden = true;
    document.body.classList.remove('privacy-banner-open');
    clearIntent();
  }

  function show(explicit = false) {
    if (dialogOpen() || (!explicit && !canPrompt())) return false;
    clearIntent();
    if (explicit) returnFocus = document.activeElement;
    banner.hidden = false;
    document.body.classList.add('privacy-banner-open');
    // Scroll-triggered prompts do not move the user's keyboard focus.
    if (explicit) banner.focus({ preventScroll: true });
    return true;
  }

  function recordIntent(event) {
    if (!event.isTrusted || event.defaultPrevented || dialogOpen() || !canPrompt() || !banner.hidden) {
      clearIntent();
      return;
    }
    intent = { x: window.scrollX, y: window.scrollY, expires: performance.now() + 800 };
  }

  window.addEventListener('wheel', event => {
    if (event.deltaY && !event.ctrlKey) recordIntent(event);
  }, { passive: true });

  window.addEventListener('touchstart', event => {
    clearIntent();
    if (event.isTrusted && !dialogOpen() && event.touches.length === 1) touchY = event.touches[0].clientY;
  }, { passive: true });
  window.addEventListener('touchmove', event => {
    if (touchY !== null && event.touches.length === 1 && Math.abs(event.touches[0].clientY - touchY) > 8) recordIntent(event);
  }, { passive: true });
  window.addEventListener('touchend', () => { touchY = null; }, { passive: true });
  window.addEventListener('touchcancel', clearIntent, { passive: true });

  window.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)
      || event.altKey || event.ctrlKey || event.metaKey
      || event.target.closest?.('input, textarea, select, button, [contenteditable="true"], [role="textbox"]')) return;
    recordIntent(event);
  });

  // A scrollbar drag is a user scroll too; ordinary clicks clear old intent
  // before an anchor or app navigation can scroll the page programmatically.
  window.addEventListener('pointerdown', event => {
    clearIntent();
    if (event.clientX >= document.documentElement.clientWidth) recordIntent(event);
  }, { passive: true });
  window.addEventListener('click', clearIntent, { capture: true });
  window.addEventListener('hashchange', clearIntent);
  window.addEventListener('popstate', clearIntent);
  window.addEventListener('scroll', event => {
    if (!event.isTrusted || (event.target !== document && event.target !== window)) return;
    if (dialogOpen()) { clearIntent(); return; }
    if (!intent || performance.now() > intent.expires) { intent = null; return; }
    if (Math.abs(window.scrollY - intent.y) > 1 || Math.abs(window.scrollX - intent.x) > 1) show();
  }, { passive: true });

  // Opening a dialog cancels the prompt. Closing it never schedules a prompt;
  // another actual user scroll (or the footer settings button) is required.
  new MutationObserver(() => {
    if (dialogOpen()) hide();
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });

  banner.addEventListener('click', event => {
    const button = event.target.closest('[data-privacy-decision]');
    if (!button) return;
    const focusWasInside = banner.contains(document.activeElement);
    onDecision(button.dataset.privacyDecision);
    decidedHere = true;
    hide();
    if (focusWasInside && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  });

  return { open: () => show(true) };
}
