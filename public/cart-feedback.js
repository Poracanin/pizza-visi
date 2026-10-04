let notice;
let dismissTimer;
let pulseTimer;

function getNotice() {
  if (notice) return notice;
  notice = document.createElement('div');
  notice.className = 'cart-feedback';
  notice.setAttribute('popover', 'manual');
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');
  notice.setAttribute('aria-atomic', 'true');
  notice.hidden = true;
  document.body.append(notice);
  return notice;
}

export function showCartFeedback({ name, image, secondImage, size, quantity = 1, updated = false }) {
  const element = getNotice();
  clearTimeout(dismissTimer);
  clearTimeout(pulseTimer);
  const supportsPopover = typeof element.showPopover === 'function';
  if (supportsPopover && element.matches(':popover-open')) element.hidePopover();
  const photo = document.createElement('div');
  photo.className = `cart-feedback-photo${size ? ' is-pizza' : ''}`;
  if (image) {
    const img = document.createElement('img');
    img.src = `./${image}`;
    img.alt = '';
    img.width = 92;
    img.height = 92;
    photo.append(img);
  }
  if (secondImage) {
    photo.classList.add('pizza-composite');
    const img = document.createElement('img');
    img.src = `./${secondImage}`;
    img.alt = '';
    photo.append(img);
  }
  const check = document.createElement('span');
  check.className = 'cart-feedback-check';
  check.setAttribute('aria-hidden', 'true');
  check.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><path d="m5 12 4 4L19 6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  photo.append(check);
  const copy = document.createElement('div');
  copy.className = 'cart-feedback-copy';
  const title = document.createElement('strong');
  title.textContent = updated ? 'Upraveno v košíku' : 'Přidáno do košíku';
  const detail = document.createElement('span');
  detail.textContent = `${quantity > 1 ? `${quantity}× ` : ''}${name}${size ? ` · ${size} cm` : ''}`;
  copy.append(title, detail);
  element.replaceChildren(photo, copy);
  element.hidden = false;
  (document.querySelector('dialog[open]') || document.body).append(element);
  if (supportsPopover) {
    // A manual popover remains visible above the native cart dialog without taking focus.
    element.showPopover();
  }
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    element.getAnimations().forEach(animation => animation.cancel());
    element.animate([
      { opacity: 0, transform: 'translate(-50%, calc(-50% + 12px)) scale(.94)' },
      { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' },
    ], { duration: 210, easing: 'cubic-bezier(.2,.75,.3,1)' });
  }
  document.querySelectorAll('.cart-trigger, .mobile-cart').forEach(cart => cart.classList.add('cart-just-added'));
  pulseTimer = setTimeout(() => document.querySelectorAll('.cart-just-added').forEach(cart => cart.classList.remove('cart-just-added')), 650);
  dismissTimer = setTimeout(() => {
    if (supportsPopover && element.matches(':popover-open')) element.hidePopover();
    element.hidden = true;
  }, 2400);
}
