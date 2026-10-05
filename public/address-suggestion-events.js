// Touch browsers may blur the input before dispatching click (or omit click).
// Commit a completed tap on pointerup while letting native list scrolling work.
export function bindAddressSuggestionEvents(root, { select, close, inputId = 'checkout-address' }) {
  const listeners = [];
  const listen = (target, type, handler) => {
    target.addEventListener(type, handler);
    listeners.push(() => target.removeEventListener(type, handler));
  };
  let gesture = null;
  let ignorePointerClick = false;
  let touchInList = false;
  const optionFor = target => target?.closest?.('[data-address-id]');
  const inCombo = target => Boolean(target?.closest?.('.address-combobox'));
  const moved = event => Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 12;

  listen(root, 'pointerdown', event => {
    if (event.isPrimary === false || event.button !== 0) return;
    gesture = null; ignorePointerClick = false; touchInList = false;
    const option = optionFor(event.target);
    if (!option || !['touch', 'pen'].includes(event.pointerType)) return;
    touchInList = true;
    gesture = { pointerId: event.pointerId, id: option.dataset.addressId, x: event.clientX, y: event.clientY, moved: false };
  });
  listen(root, 'pointermove', event => {
    if (gesture?.pointerId === event.pointerId && moved(event)) gesture.moved = true;
  });
  listen(root, 'pointerup', event => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const tap = !gesture.moved && !moved(event) && optionFor(event.target)?.dataset.addressId === gesture.id;
    const id = gesture.id;
    gesture = null;
    ignorePointerClick = true;
    if (tap) {
      event.preventDefault();
      select(id, { pointerType: event.pointerType });
    }
  });
  listen(root, 'pointercancel', event => {
    if (gesture?.pointerId !== event.pointerId) return;
    ignorePointerClick = true;
    gesture = null;
  });
  // Preserve input focus for mouse selection without canceling touch pointerdown.
  listen(root, 'mousedown', event => {
    if (event.button === 0 && optionFor(event.target)) event.preventDefault();
  });
  listen(root, 'click', event => {
    const option = optionFor(event.target);
    if (option) {
      if (event.detail !== 0 && ignorePointerClick) return;
      ignorePointerClick = false;
      select(option.dataset.addressId);
    } else if (!inCombo(event.target)) close();
  });
  listen(root, 'focusout', event => {
    if (event.target.id !== inputId || inCombo(event.relatedTarget)) return;
    if (gesture || (touchInList && !event.relatedTarget)) return;
    close();
  });
  listen(root.ownerDocument, 'pointerdown', event => {
    if (event.isPrimary === false) return;
    if (root.contains(event.target) && inCombo(event.target)) return;
    gesture = null; ignorePointerClick = false; touchInList = false;
    close();
  });
  return () => {
    listeners.forEach(remove => remove());
    gesture = null;
  };
}
