import test from 'node:test';
import assert from 'node:assert/strict';
import { initDeliveryAddressChecker } from '../public/delivery-address-checker.js';

// A small event/element fixture exercises lookup transitions without a browser
// dependency. The real RÚIAN resolver and suggestion gesture helper are used.
class Element extends EventTarget {
  constructor(parent, attributes = {}) {
    super();
    Object.assign(this, { parentElement: parent, ownerDocument: parent?.ownerDocument,
      dataset: {}, attributes: new Map(), classList: { add() {} }, hidden: false,
      value: '', id: '', nodes: new Map(), options: [], html: '' }, attributes);
  }
  set innerHTML(value) {
    this.html = value;
    this.options = [...value.matchAll(/<li id="([^"]+)" role="option" aria-selected="false" data-address-id="([^"]+)"/g)]
      .map(([, id, addressId]) => new Element(this, { id, dataset: { addressId } }));
  }
  get innerHTML() { return this.html; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  querySelector(selector) { return this.nodes.get(selector); }
  querySelectorAll() { return this.options; }
  scrollIntoView() {}
  contains(element) { return element === this || Boolean(element?.parentElement && this.contains(element.parentElement)); }
  closest(selector) {
    if (selector === '[data-address-id]' && this.dataset.addressId) return this;
    if (selector === '.address-combobox' && this.combo) return this;
    return this.parentElement?.closest?.(selector) || null;
  }
  focus() {
    if (this.ownerDocument.activeElement === this) return;
    this.ownerDocument.activeElement = this;
    fire(this, 'focus');
  }
  blur() { this.ownerDocument.activeElement = null; fire(this, 'focusout'); }
}
function fire(target, type, properties = {}) {
  const event = new Event(type, { cancelable: true });
  for (const [key, value] of Object.entries({ target, detail: 0, relatedTarget: null, ...properties })) {
    Object.defineProperty(event, key, { value });
  }
  for (let element = target; element; element = element.parentElement) {
    element.dispatchEvent(event);
    if (event.cancelBubble) break;
  }
  return event;
}
function fixture() {
  const doc = new Element(null);
  doc.ownerDocument = doc;
  const root = new Element(doc);
  const combo = new Element(root, { combo: true });
  const input = new Element(combo, { id: 'delivery-coverage-address' });
  const list = new Element(combo, { hidden: true });
  const status = new Element(root);
  const form = new Element(root);
  const clear = new Element(combo, { hidden: true });
  const retry = new Element(root, { hidden: true });
  const contact = new Element(root, { hidden: true });
  const result = new Element(root, { hidden: true });
  root.nodes = new Map([
    ['#delivery-coverage-address', input], ['#delivery-coverage-address-results', list],
    ['#delivery-coverage-address-status', status], ['.delivery-address-form', form],
    ['.delivery-address-clear', clear], ['.delivery-address-retry', retry],
    ['.delivery-address-contact', contact], ['.delivery-address-result', result]
  ]);
  const selections = [];
  const cleanup = initDeliveryAddressChecker(root, [
    { id: 'rudna', name: 'Rudná' }, { id: 'hostivice', name: 'Hostivice' }, { id: 'beroun', name: 'Beroun' }
  ], { onSelect: address => selections.push(address) });
  return { root, doc, input, list, status, form, clear, retry, contact, result, selections, cleanup,
    type(value) { input.value = value; fire(input, 'input'); } };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const data = {
  version: 1, count: 3, source: { dataDate: '2026-09-30' }, records: [
    ['101', 'Riegerova 527/50, Rudná', 1, '25219'],
    ['102', 'Pivovarská 105/11, Beroun', 4, '26601'],
    ['103', 'Hrozenkovská 12, Praha-Zličín', 3, '15521']
  ]
};

test('lookup only confirms chosen canonical addresses and survives loading, retry, edits and cleanup', async t => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let fulfill;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls <= 2) throw new Error('offline');
    return new Promise(resolve => { fulfill = () => resolve({ ok: true, json: async () => data }); });
  };
  const f = fixture();
  t.after(() => { f.cleanup(); globalThis.fetch = originalFetch; });

  assert.equal(calls, 0, 'mounting does not download addresses');
  f.input.focus();
  await settle();
  assert.equal(f.retry.hidden, false);
  assert.match(f.status.textContent, /nepodařilo načíst/);
  assert.equal(f.result.hidden, true, 'load errors cannot confirm delivery');

  fire(f.retry, 'click');
  await settle();
  assert.equal(f.retry.hidden, false, 'a failed retry still offers another retry');
  assert.match(f.status.textContent, /nepodařilo načíst/);
  fire(f.retry, 'click');
  f.type('Riegerova');
  f.type('Pivovarská');
  fulfill();
  await settle();
  assert.equal(calls, 3, 'overlapping requests reuse the same load promise');
  assert.deepEqual(f.list.options.map(option => option.dataset.addressId), ['102'], 'only the latest query renders');
  assert.equal(f.result.hidden, true);

  f.type('Pivovarská 105/11, Beroun');
  fire(f.form, 'submit');
  assert.equal(f.result.hidden, true, 'even an exact typed address requires a suggestion choice');
  assert.ok(f.selections.every(address => address === null));
  fire(f.input, 'keydown', { key: 'ArrowDown' });
  assert.equal(f.input.getAttribute('aria-activedescendant'), 'delivery-coverage-address-option-102');
  fire(f.input, 'keydown', { key: 'Enter' });
  assert.equal(f.selections.at(-1).id, '102');
  assert.equal(f.result.hidden, false);
  assert.match(f.result.innerHTML, /Ano, sem rozvážíme/);
  assert.match(f.result.innerHTML, /Beroun/);

  f.type('Hrozenkovská');
  assert.equal(f.result.hidden, true, 'editing invalidates a previous confirmation immediately');
  assert.equal(f.selections.at(-1), null);
  fire(f.input, 'keydown', { key: 'ArrowUp' });
  fire(f.input, 'keydown', { key: 'Enter' });
  assert.deepEqual(f.selections.at(-1).branchIds, ['rudna', 'hostivice']);
  assert.match(f.result.innerHTML, /Rudná a Hostivice/);

  fire(f.clear, 'click');
  assert.equal(f.input.value, '');
  assert.equal(f.result.hidden, true);
  assert.equal(f.selections.at(-1), null);
  f.type('Pi');
  assert.equal(f.list.hidden, true, 'fewer than three characters cannot open results');
  f.type('Neexistující 99999');
  assert.match(f.status.textContent, /Adresu se nepodařilo ověřit/);
  assert.equal(f.contact.hidden, false);
  assert.equal(f.result.hidden, true);

  f.type('Riegerova');
  fire(f.input, 'keydown', { key: 'Escape' });
  assert.equal(f.list.hidden, true);
  assert.equal(f.input.getAttribute('aria-activedescendant'), null);
  f.type('Riegerova');
  fire(f.input, 'keydown', { key: 'Tab' });
  assert.equal(f.list.hidden, true);

  f.cleanup();
  const previousCount = f.selections.length;
  f.type('Pivovarská');
  assert.equal(f.selections.length, previousCount, 'cleanup detaches input listeners');
});
