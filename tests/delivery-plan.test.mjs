import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createState, addOrder, transitionOrder, restoreState} from '../public/admin/model.js';
import {deliveryPlan, deliveryAssignment, deliveryOrders, saveDeliveryPlan} from '../public/admin/delivery.js';
const site = JSON.parse(fs.readFileSync(new URL('../public/data/site.json', import.meta.url)));
const seed = JSON.parse(fs.readFileSync(new URL('../public/admin/seed.json', import.meta.url)));
const now = '2026-09-21T10:00:00.000Z';
const empty = () => [[], [], []];
const restore = state => restoreState(JSON.stringify(state), site, seed);
function fixture() {
  let state = createState(site, seed, now);
  const ids = [];
  for (const [branchId, fulfillment] of [['rudna','delivery'],['rudna','delivery'],['rudna','delivery'],['beroun','delivery'],['rudna','pickup']]) {
    const result = addOrder(state, site, {branchId, fulfillment, source:'web', payment:'online', label:'Demo', deliveryAddress:'Testovací 12, Rudná', lines:[{pizzaId:'1-margherita',size:30,quantity:1}]}, now);
    state = result.state; ids.push(result.order.id);
  }
  return {state, ids};
}
test('Plán uchová pořadí zastávek a tři kurýry po obnovení, bez změny skladu', () => {
  const {state,ids:[a,b,c]} = fixture();
  const routes = [[b,a],[],[c]], next = saveDeliveryPlan(state,'rudna',routes,empty());
  assert.deepEqual(deliveryPlan(restore(next),'rudna'),routes);
  assert.deepEqual(deliveryAssignment(next,next.orders.find(o=>o.id===a)),{courierId:1,position:2});
  assert.deepEqual(deliveryPlan(next,'beroun'),empty());
  assert.deepEqual(next.stocks,state.stocks); assert.deepEqual(next.movements,state.movements); assert.deepEqual(next.orders,state.orders);
  assert.deepEqual(deliveryPlan(state,'rudna'),empty());
  assert.equal(deliveryOrders(state,'rudna').length,3);
});
test('Plán odmítá dvojí přiřazení, jinou pobočku, osobní odběr a čtvrtého kurýra', () => {
  const {state,ids:[a,,,beroun,pickup]} = fixture();
  for (const plan of [[[a],[a],[]], [[a,a],[],[]], [[beroun],[],[]], [[pickup],[],[]], [[],[],[],[]], [['VISI-9999'],[],[]], [null,[],[]]]) {
    assert.throws(()=>saveDeliveryPlan(state,'rudna',plan,empty()));
  }
  assert.throws(()=>saveDeliveryPlan(state,'invalid',empty(),empty()));
  const cancelled = transitionOrder(state,a,'cancelled',seed,now);
  assert.throws(()=>saveDeliveryPlan(cancelled,'rudna',[[a],[],[]],empty()),/už není dostupná/);
});
test('Přesun kurýra, změna pořadí i zrušení přiřazení zachovají jedinou souvislou trasu', () => {
  const {state,ids:[a,b,c]} = fixture();
  let next = saveDeliveryPlan(state,'rudna',[[a,b],[c],[]],empty());
  next = saveDeliveryPlan(next,'rudna',[[b],[c,a],[]],deliveryPlan(next,'rudna'));
  assert.deepEqual(deliveryAssignment(next,next.orders.find(o=>o.id===a)),{courierId:2,position:2});
  assert.deepEqual(deliveryAssignment(next,next.orders.find(o=>o.id===b)),{courierId:1,position:1});
  next = saveDeliveryPlan(next,'rudna',empty(),deliveryPlan(next,'rudna'));
  assert.equal(deliveryAssignment(next,next.orders.find(o=>o.id===a)),null);
  assert.deepEqual(deliveryPlan(restore(next),'rudna'),empty());
});
test('Předání vyžaduje připravenou objednávku a kurýra, uloží záznam a neopakuje odečet', () => {
  let {state,ids:[a,b]} = fixture();
  state = transitionOrder(state,a,'preparing',seed,now);
  assert.throws(()=>transitionOrder(state,a,'completed',seed,now),/přechod/);
  state = transitionOrder(state,a,'ready',seed,now);
  assert.throws(()=>transitionOrder(state,a,'completed',seed,now),/přiřaďte/);
  state = saveDeliveryPlan(state,'rudna',[[],[b,a],[]],empty());
  const next = transitionOrder(state,a,'completed',seed,now);
  assert.deepEqual(next.orders.find(o=>o.id===a).handoff,{courierId:2,position:2,at:now});
  assert.deepEqual(deliveryPlan(next,'rudna'),[[],[b],[]]);
  assert.deepEqual(next.stocks,state.stocks); assert.deepEqual(next.movements,state.movements);
  assert.deepEqual(restore(next),next);
  assert.equal(transitionOrder(next,a,'completed',seed,now),next);
  const corrupt = structuredClone(next); corrupt.orders.find(o=>o.id===a).handoff.courierId = 4;
  assert.throws(()=>restore(corrupt),/předání kurýrovi/);
});
test('Zrušení objednávky ji vyřadí z trasy a přečísluje zbývající zastávky', () => {
  const {state,ids:[a,b]} = fixture();
  const planned = saveDeliveryPlan(state,'rudna',[[a,b],[],[]],empty());
  const next = transitionOrder(planned,a,'cancelled',seed,now);
  assert.deepEqual(deliveryPlan(next,'rudna'),[[b],[],[]]);
  assert.deepEqual(deliveryAssignment(next,next.orders.find(o=>o.id===b)),{courierId:1,position:1});
  assert.deepEqual(next.stocks,state.stocks); assert.deepEqual(restore(next),next);
});
test('Souběžná změna stejné trasy se nepřepíše, jiná pobočka neblokuje uložení', () => {
  const {state,ids:[a,b,,beroun]} = fixture();
  const planned = saveDeliveryPlan(state,'rudna',[[a],[],[]],empty());
  assert.throws(()=>saveDeliveryPlan(planned,'rudna',[[b],[],[]],empty()),/jiné okno/);
  const next = saveDeliveryPlan(planned,'beroun',[[beroun],[],[]],empty());
  assert.deepEqual(deliveryPlan(next,'rudna'),[[a],[],[]]);
  assert.deepEqual(deliveryPlan(next,'beroun'),[[beroun],[],[]]);
  const corrupt = structuredClone(next); corrupt.deliveryPlans.rudna[1].push(a);
  assert.throws(()=>restore(corrupt),/jen jednomu/);
});
test('Starší uložené demo funguje bez plánů, doručovací adresa patří pouze rozvozu', () => {
  const {state,ids:[a,,,,pickup]} = fixture();
  assert.equal(state.deliveryPlans,undefined); assert.deepEqual(restore(state),state);
  assert.equal(state.orders.find(o=>o.id===a).deliveryAddress,'Testovací 12, Rudná');
  assert.equal(state.orders.find(o=>o.id===pickup).deliveryAddress,'');
});
