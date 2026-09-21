import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createState, addOrder, transitionOrder, restoreState} from '../public/admin/model.js';
import {deliveryPlan, deliveryAssignment, deliveryOrders, saveDeliveryPlan, toggleDeliveryStop, platformCourier} from '../public/admin/delivery.js';
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
test('Kliknutí na jiného kurýra nesmí převzít již přiřazenou objednávku', () => {
  const plan = toggleDeliveryStop(empty(),1,'VISI-1041');
  assert.throws(()=>toggleDeliveryStop(plan,2,'VISI-1041'),/již má kurýr 1/);
  assert.throws(()=>toggleDeliveryStop(plan,3,'VISI-1041'),/již má kurýr 1/);
  assert.deepEqual(plan,[['VISI-1041'],[],[]]);
  const removed = toggleDeliveryStop(plan,1,'VISI-1041');
  assert.deepEqual(toggleDeliveryStop(removed,2,'VISI-1041'),[[],['VISI-1041'],[]]);
});
test('Wolt, Bolt a foodora mají vlastní kurýry, nelze je přiřadit do našich tras', () => {
  for (const source of ['wolt','bolt','foodora']) {
    const {state} = fixture();
    const added = addOrder(state,site,{branchId:'rudna',source,fulfillment:'pickup',payment:'online',lines:[{pizzaId:'1-margherita',size:30,quantity:1}]},now);
    assert.equal(added.order.fulfillment,'delivery');
    assert.equal(platformCourier(added.order),source);
    assert.ok(!deliveryOrders(added.state,'rudna').some(o=>o.id===added.order.id));
    assert.equal(deliveryAssignment(added.state,added.order),null);
    assert.throws(()=>saveDeliveryPlan(added.state,'rudna',[[added.order.id],[],[]],empty()),/není dostupná/);
    let next = transitionOrder(added.state,added.order.id,'preparing',seed,now);
    next = transitionOrder(next,added.order.id,'ready',seed,now);
    const handed = transitionOrder(next,added.order.id,'completed',seed,now);
    assert.deepEqual(handed.orders.find(o=>o.id===added.order.id).handoff,{provider:source,at:now});
    assert.deepEqual(handed.stocks,next.stocks); assert.deepEqual(handed.movements,next.movements);
    assert.deepEqual(restore(handed),handed);
    assert.equal(transitionOrder(handed,added.order.id,'completed',seed,now),handed);
    const corrupt = structuredClone(handed); corrupt.orders.find(o=>o.id===added.order.id).handoff.provider='web';
    assert.throws(()=>restore(corrupt),/předání kurýrovi/);
  }
});
test('Staré plány odstraní externí služby a zachovají vlastní zastávky, ceny a historii', () => {
  let {state,ids:[a,b,c]} = fixture();
  const external=[];
  for(const source of ['wolt','bolt','foodora']) {
    const added=addOrder(state,site,{branchId:'rudna',source,fulfillment:'delivery',payment:'online',lines:[{pizzaId:'1-margherita',size:30,quantity:1}]},now);
    state=added.state; external.push(added.order.id);
  }
  delete state.courierPolicyVersion;
  state.deliveryPlans={rudna:[[external[0],a],[external[1],b],[external[2],c]]};
  state.orders.find(o=>o.id===external[2]).fulfillment='pickup'; // Legacy sample order.
  const migrated=restore(state);
  assert.equal(migrated.courierPolicyVersion,1);
  assert.deepEqual(deliveryPlan(migrated,'rudna'),[[a],[b],[c]]);
  assert.equal(migrated.orders.find(o=>o.id===external[2]).fulfillment,'delivery');
  assert.deepEqual(migrated.orders.map(o=>o.total),state.orders.map(o=>o.total));
  assert.deepEqual(migrated.stocks,state.stocks); assert.deepEqual(migrated.movements,state.movements);
  assert.deepEqual(restore(migrated),migrated);
});
test('Dřívější záznam předání externí objednávky se při opravě plánů nepřepíše', () => {
  let {state,ids:[a]}=fixture();
  state=transitionOrder(state,a,'preparing',seed,now);state=transitionOrder(state,a,'ready',seed,now);
  state=saveDeliveryPlan(state,'rudna',[[a],[],[]],empty());state=transitionOrder(state,a,'completed',seed,now);
  state.orders.find(o=>o.id===a).source='wolt';delete state.courierPolicyVersion;
  assert.deepEqual(restore(state).orders.find(o=>o.id===a).handoff,{courierId:1,position:1,at:now});
});
