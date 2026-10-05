import test from 'node:test';
import assert from 'node:assert/strict';
import { bindAddressSuggestionEvents } from '../public/address-suggestion-events.js';

class Element extends EventTarget {
  constructor(parent, attributes = {}) { super(); this.parentElement = parent; Object.assign(this, { dataset: {}, id: '' }, attributes); }
  closest(selector) {
    if (selector === '[data-address-id]' && this.dataset.addressId) return this;
    if (selector === '.address-combobox' && this.combo) return this;
    return this.parentElement?.closest(selector) || null;
  }
  contains(element) { return element === this || Boolean(element?.parentElement && this.contains(element.parentElement)); }
}
function fixture(inputId = 'checkout-address') {
  const doc = new EventTarget();
  const root = new Element(null, { ownerDocument: doc });
  const combo = new Element(root, { combo: true });
  const input = new Element(combo, { id: inputId });
  const option = new Element(combo, { dataset: { addressId: '6348416' } });
  const second = new Element(combo, { dataset: { addressId: '12757250' } });
  const contact = new Element(root, { id: 'contact' });
  let open = true;
  const selections = [];
  const cleanup = bindAddressSuggestionEvents(root, {
    inputId,
    select(id, options) { selections.push({ id, ...options }); open = false; },
    close() { open = false; }
  });
  function fire(type, target = option, properties = {}) {
    const event = new Event(type, { cancelable: true });
    const values = { target, pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, clientX: 100, clientY: 200, detail: 1, relatedTarget: null, ...properties };
    for (const [key, value] of Object.entries(values)) Object.defineProperty(event, key, { value });
    if (root.contains(target)) root.dispatchEvent(event);
    doc.dispatchEvent(event);
    return event;
  }
  return { cleanup, root, input, option, second, contact, fire, selections, isOpen: () => open };
}

test('A mobile tap survives input blur and selects on release even without a click', () => {
  const f = fixture();
  assert.equal(f.fire('pointerdown').defaultPrevented, false, 'native touch scrolling remains enabled');
  f.fire('focusout', f.input);
  assert.equal(f.isOpen(), true, 'the option must remain present until release');
  assert.equal(f.fire('pointerup').defaultPrevented, true);
  assert.deepEqual(f.selections, [{ id: '6348416', pointerType: 'touch' }]);
  assert.equal(f.isOpen(), false);
  f.fire('click');
  assert.equal(f.selections.length, 1, 'a compatibility click must not select twice');
});

test('Scrolling suggestions never selects an address, even if the finger returns to its start', () => {
  const f = fixture();
  f.fire('pointerdown');
  f.fire('focusout', f.input);
  f.fire('pointermove', f.option, { clientY: 160 });
  f.fire('pointermove');
  f.fire('pointerup');
  f.fire('click');
  assert.deepEqual(f.selections, []);
  assert.equal(f.isOpen(), true);
  f.fire('pointerdown', f.second);
  f.fire('pointerup', f.second);
  assert.equal(f.selections[0].id, '12757250', 'a subsequent deliberate tap still works');
});

test('Canceled touches and releasing over another option do not commit an address', () => {
  const f = fixture();
  f.fire('pointerdown');
  f.fire('pointercancel');
  f.fire('focusout', f.input);
  f.fire('pointerup');
  f.fire('click');
  assert.equal(f.isOpen(), true);
  assert.deepEqual(f.selections, []);
  f.fire('pointerdown');
  f.fire('pointerup', f.second);
  f.fire('click', f.second);
  assert.deepEqual(f.selections, []);
});

test('Mouse focus stays in the input; mouse and assistive-technology clicks still select', () => {
  const f = fixture();
  f.fire('pointerdown', f.option, { pointerType: 'mouse' });
  assert.equal(f.fire('mousedown', f.option, { pointerType: 'mouse' }).defaultPrevented, true);
  f.fire('pointerup', f.option, { pointerType: 'mouse' });
  assert.deepEqual(f.selections, []);
  f.fire('click', f.option, { pointerType: 'mouse' });
  assert.equal(f.selections[0].id, '6348416');
  f.fire('click', f.second, { detail: 0 });
  assert.equal(f.selections[1].id, '12757250');
});

test('Tabbing away or tapping outside closes the list and cancels a pending gesture', () => {
  const tab = fixture();
  tab.fire('focusout', tab.input, { relatedTarget: tab.contact });
  assert.equal(tab.isOpen(), false);
  const touch = fixture();
  touch.fire('pointerdown');
  touch.fire('pointerdown', new Element(null));
  touch.fire('pointerup');
  assert.equal(touch.isOpen(), false);
  assert.deepEqual(touch.selections, []);
});

test('A second finger cannot replace the active tap', () => {
  const f = fixture();
  f.fire('pointerdown');
  f.fire('pointerdown', f.second, { pointerId: 8, isPrimary: false });
  f.fire('pointerup', f.second, { pointerId: 8, isPrimary: false });
  f.fire('pointerup');
  assert.deepEqual(f.selections, [{ id: '6348416', pointerType: 'touch' }]);
});


test('Independent homepage input closes on focus loss while preserving touch selection', () => {
  const keyboard = fixture('delivery-coverage-address');
  keyboard.fire('focusout', keyboard.input, { relatedTarget: keyboard.contact });
  assert.equal(keyboard.isOpen(), false);
  const touch = fixture('delivery-coverage-address');
  touch.fire('pointerdown');
  touch.fire('focusout', touch.input);
  assert.equal(touch.isOpen(), true);
  touch.fire('pointerup');
  assert.deepEqual(touch.selections, [{ id: '6348416', pointerType: 'touch' }]);
});

test('Cleanup removes root and document listeners without affecting other address fields', () => {
  const f = fixture('delivery-coverage-address');
  f.cleanup();
  f.fire('click');
  f.fire('pointerdown', new Element(null));
  assert.equal(f.isOpen(), true);
  assert.deepEqual(f.selections, []);
});
