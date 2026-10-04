// Touch browsers may blur the input before dispatching click (or omit click).
// Commit a completed tap on pointerup while letting native list scrolling work.
export function bindAddressSuggestionEvents(root, { select, close }) {
  let gesture = null;
  let ignorePointerClick = false;
  let touchInList = false;
  const optionFor = target => target?.closest?.('[data-address-id]');
  const inCombo = target => Boolean(target?.closest?.('.address-combobox'));
  const moved = event => Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 12;

  root.addEventListener('pointerdown', event => {
    if (event.isPrimary === false || event.button !== 0) return;
    gesture = null; ignorePointerClick = false; touchInList = false;
    const option = optionFor(event.target);
    if (!option || !['touch', 'pen'].includes(event.pointerType)) return;
    touchInList = true;
    gesture = { pointerId: event.pointerId, id: option.dataset.addressId, x: event.clientX, y: event.clientY, moved: false };
  });
  root.addEventListener('pointermove', event => {
    if (gesture?.pointerId === event.pointerId && moved(event)) gesture.moved = true;
  });
  root.addEventListener('pointerup', event => {
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
  root.addEventListener('pointercancel', event => {
    if (gesture?.pointerId !== event.pointerId) return;
    ignorePointerClick = true;
    gesture = null;
  });
  // Preserve input focus for mouse selection without canceling touch pointerdown.
  root.addEventListener('mousedown', event => {
    if (event.button === 0 && optionFor(event.target)) event.preventDefault();
  });
  root.addEventListener('click', event => {
    const option = optionFor(event.target);
    if (option) {
      if (event.detail !== 0 && ignorePointerClick) return;
      ignorePointerClick = false;
      select(option.dataset.addressId);
    } else if (!inCombo(event.target)) close();
  });
  root.addEventListener('focusout', event => {
    if (event.target.id !== 'checkout-address' || inCombo(event.relatedTarget)) return;
    if (gesture || (touchInList && !event.relatedTarget)) return;
    close();
  });
  root.ownerDocument.addEventListener('pointerdown', event => {
    if (event.isPrimary === false) return;
    if (root.contains(event.target) && inCombo(event.target)) return;
    gesture = null; ignorePointerClick = false; touchInList = false;
    close();
  });
}
