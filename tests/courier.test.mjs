import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {restoreState, addOrder, transitionOrder} from '../public/admin/model.js';
import {saveDeliveryPlan, deliveryPlan} from '../public/admin/delivery.js';
import {createCourierPreview, upgradeCourierPreviewAddresses, courierOrders, courierHistory, deliveryStatus, takeOrder, finishDelivery, setDeliveryIssue, validateCourierState, ISSUE_REASONS, courierPaymentQuote, collectDemoPayment, courierPaymentTotals} from '../public/courier-model.js';
const site = JSON.parse(fs.readFileSync(new URL('../public/data/site.json', import.meta.url)));
const seed = JSON.parse(fs.readFileSync(new URL('../public/admin/seed.json', import.meta.url)));
const now = '2026-09-21T11:00:00.000Z', later = '2026-09-21T11:15:00.000Z';
const fixture = () => createCourierPreview(site, seed, now);
const restore = state => validateCourierState(restoreState(JSON.stringify(state), site, seed));

test('Mobile preview has three stops per branch, preserves order, and restores through POS validation', () => {
  const state = fixture();
  for (const branch of site.branches) {
    const orders = courierOrders(state, branch.id, 1);
    assert.equal(orders.length,3);
    assert.deepEqual(orders.map(deliveryStatus),['driving','driving','ready']);
    assert.deepEqual(orders.map(o=>o.payment),['cash','online','card']);
    assert.ok(orders.every(o=>o.courierPreview && !o.phone));
    assert.deepEqual(courierOrders(state,branch.id,2),[]);
    assert.deepEqual(courierHistory(state,branch.id,1),[]);
  }
  assert.deepEqual(restore(state),state);
});
test('Taking a ready order removes it from the plan, records handoff, and never deducts stock again', () => {
  const state = fixture(), order = courierOrders(state,'rudna',1)[2];
  const next = takeOrder(state,order.id,'rudna',1,seed,later);
  assert.equal(deliveryStatus(next.orders.find(o=>o.id===order.id)),'driving');
  assert.deepEqual(deliveryPlan(next,'rudna'),[[],[],[]]);
  assert.deepEqual(next.stocks,state.stocks); assert.deepEqual(next.movements,state.movements); assert.deepEqual(next.batches,state.batches);
  assert.deepEqual(restore(next),next);
  assert.equal(takeOrder(next,order.id,'rudna',1,seed,later),next);
  assert.equal(state.orders.find(o=>o.id===order.id).status,'ready');
});
test('True delivery follows handoff, requires cash/card confirmation, and is idempotent', () => {
  const state = fixture(), order = courierOrders(state,'rudna',1)[0];
  assert.throws(()=>finishDelivery(state,order.id,'rudna',1,false,later),/Potvrďte/);
  assert.throws(()=>finishDelivery(state,order.id,'rudna',1,'true',later),/Potvrďte/);
  const next = finishDelivery(state,order.id,'rudna',1,true,later);
  assert.equal(courierOrders(next,'rudna',1).length,2);
  assert.equal(courierHistory(next,'rudna',1)[0].id,order.id);
  assert.equal(deliveryStatus(courierHistory(next,'rudna',1)[0]),'delivered');
  assert.deepEqual(next.stocks,state.stocks); assert.deepEqual(next.movements,state.movements); assert.deepEqual(next.batches,state.batches);
  assert.deepEqual(next.deliveryPlans,state.deliveryPlans);
  assert.equal(finishDelivery(next,order.id,'rudna',1,true,later),next);
  assert.deepEqual(restore(next),next);
  assert.equal(order.courierDelivery,undefined);
  const card = courierOrders(state,'rudna',1)[2];
  assert.throws(()=>finishDelivery(state,card.id,'rudna',1,true,later),/Nejdříve převezměte/);
  const picked = takeOrder(state,card.id,'rudna',1,seed,later);
  assert.throws(()=>finishDelivery(picked,card.id,'rudna',1,false,later),/Potvrďte/);
  assert.equal(courierHistory(finishDelivery(picked,card.id,'rudna',1,true,later),'rudna',1).length,1);
});
test('Online demo payments need no additional collection and history stays scoped by branch and courier', () => {
  const state = fixture(), order = courierOrders(state,'rudna',1)[1];
  const next = finishDelivery(state,order.id,'rudna',1,false,later);
  assert.equal(courierHistory(next,'rudna',1)[0].courierDelivery.payment,'online');
  assert.deepEqual(courierHistory(next,'beroun',1),[]);
  assert.deepEqual(courierHistory(next,'rudna',2),[]);
  assert.deepEqual(restore(next),next);
});
test('Courier and branch mismatches cannot take, finish, or change a delivery', () => {
  const state = fixture(), [driving,,ready] = courierOrders(state,'rudna',1);
  for (const [branch,courier] of [['beroun',1],['rudna',2],['rudna',4]]) {
    assert.throws(()=>takeOrder(state,ready.id,branch,courier,seed,later));
    assert.throws(()=>finishDelivery(state,driving.id,branch,courier,true,later));
    assert.throws(()=>setDeliveryIssue(state,driving.id,branch,courier,ISSUE_REASONS[0],later));
  }
  const plan = deliveryPlan(state,'rudna');
  const reassigned = saveDeliveryPlan(state,'rudna',[[],[ready.id],[]],plan);
  assert.throws(()=>takeOrder(reassigned,ready.id,'rudna',1,seed,later),/jiný kurýr/);
  assert.equal(courierOrders(reassigned,'rudna',2)[0].id,ready.id);
});
test('Issues block completion until resolved, and delivery time cannot precede handoff', () => {
  const state = fixture(), order = courierOrders(state,'rudna',1)[0];
  const issue = setDeliveryIssue(state,order.id,'rudna',1,ISSUE_REASONS[0],later);
  assert.equal(deliveryStatus(courierOrders(issue,'rudna',1)[0]),'issue');
  assert.throws(()=>finishDelivery(issue,order.id,'rudna',1,true,later),/vyřešte problém/);
  assert.deepEqual(restore(issue),issue);
  const resolved = setDeliveryIssue(issue,order.id,'rudna',1,null,later);
  const done = finishDelivery(resolved,order.id,'rudna',1,true,later);
  assert.throws(()=>setDeliveryIssue(done,order.id,'rudna',1,ISSUE_REASONS[0],later),/probíhajícího/);
  assert.throws(()=>setDeliveryIssue(state,order.id,'rudna',1,'Unknown',later),/důvod/);
  assert.throws(()=>finishDelivery(state,order.id,'rudna',1,true,'2026-09-20T00:00:00Z'),/Čas/);
  assert.deepEqual(restore(done),done);
});
test('External couriers and pickup orders never appear in own courier routes', () => {
  for (const source of ['wolt','foodora','bolt']) {
    let state = fixture();
    const result = addOrder(state,site,{branchId:'rudna',source,fulfillment:'delivery',payment:'online',lines:[{pizzaId:'1-margherita',size:30,quantity:1}]},now);
    state = transitionOrder(result.state,result.order.id,'preparing',seed,now);
    state = transitionOrder(state,result.order.id,'ready',seed,now);
    state = transitionOrder(state,result.order.id,'completed',seed,now);
    assert.equal(courierOrders(state,'rudna',1).length,3);
    assert.throws(()=>finishDelivery(state,result.order.id,'rudna',1,true,later),/není dostupná/);
  }
});
test('Pending and addressless orders cannot be taken; corrupted courier records are rejected', () => {
  let state = fixture();
  const result = addOrder(state,site,{branchId:'rudna',source:'pos',fulfillment:'delivery',payment:'cash',deliveryAddress:'',lines:[{pizzaId:'1-margherita',size:30,quantity:1}]},now);
  state = saveDeliveryPlan(result.state,'rudna',[[result.order.id],[],[]],deliveryPlan(result.state,'rudna'));
  assert.throws(()=>takeOrder(state,result.order.id,'rudna',1,seed,later),/není připravená/);
  state = transitionOrder(state,result.order.id,'preparing',seed,now);
  state = transitionOrder(state,result.order.id,'ready',seed,now);
  assert.throws(()=>takeOrder(state,result.order.id,'rudna',1,seed,later),/adresu/);
  const done = finishDelivery(state,courierOrders(state,'rudna',1)[0].id,'rudna',1,true,later);
  for (const patch of [{deliveredAt:'bad'},{payment:'qr'},{paymentConfirmedAt:now},{issue:ISSUE_REASONS[0],issueAt:later}]) {
    const broken = structuredClone(done);
    Object.assign(courierHistory(broken,'rudna',1)[0].courierDelivery,patch);
    assert.throws(()=>restore(broken),/potvrzení doručení/);
  }
  const broken = fixture(); courierOrders(broken,'rudna',1)[2].courierDelivery = {deliveredAt:later};
  assert.throws(()=>restore(broken),/záznam rozvozu/);
});


test('Sample maps update legacy preview addresses without resetting delivered orders or touching POS orders', () => {
  let state = fixture();
  const order = courierOrders(state,'rudna',1)[0];
  state = finishDelivery(state,order.id,'rudna',1,true,later);
  const legacy = structuredClone(state);
  for (const branch of site.branches) {
    const orders = legacy.orders.filter(o => o.branchId === branch.id).sort((a,b) => a.id.localeCompare(b.id));
    for (const [i, sample] of orders.entries()) {
      sample.deliveryAddress = `${['Ukázková 12','Vzorová 8','Cvičná 5'][i]}, ${branch.name}`;
      delete sample.courierMapSample;
    }
  }
  const migrated = upgradeCourierPreviewAddresses(legacy, site);
  assert.deepEqual(migrated,state);
  assert.equal(courierHistory(migrated,'rudna',1)[0].id,order.id);
  assert.deepEqual(restore(migrated),migrated);
  assert.equal(upgradeCourierPreviewAddresses(migrated,site),migrated);
  const custom = structuredClone(legacy);
  custom.orders[0].deliveryAddress = 'Vlastní upravená adresa';
  custom.orders[1].courierPreview = false;
  const safe = upgradeCourierPreviewAddresses(custom,site);
  assert.deepEqual(safe.orders[0],custom.orders[0]);
  assert.deepEqual(safe.orders[1],custom.orders[1]);
  assert.equal(courierOrders(migrated,'rudna',1)[0].deliveryAddress,'Riegerova 527/50, Rudná');
});

test('QR/card/cash receipts include the tip, persist before delivery and do not collect twice', () => {
  for (const method of ['qr','card','cash']) {
    const state = fixture(), order = courierOrders(state,'rudna',1)[0];
    const paid = collectDemoPayment(state,order.id,'rudna',1,method,50,later);
    assert.deepEqual(restore(paid),paid);
    assert.equal(courierOrders(paid,'rudna',1).length,3);
    const receipt = paid.orders.find(o=>o.id===order.id).courierPayment;
    assert.deepEqual(receipt,{method,base:order.total,tip:50,amount:order.total+50,demo:true,confirmedAt:later});
    assert.equal(collectDemoPayment(paid,order.id,'rudna',1,method,50,later),paid);
    assert.throws(()=>collectDemoPayment(paid,order.id,'rudna',1,method,100,later),/už je potvrzená/);
    const delivered = finishDelivery(paid,order.id,'rudna',1,false,'2026-09-21T11:16:00Z');
    assert.equal(courierHistory(delivered,'rudna',1)[0].courierDelivery.payment,method);
    assert.deepEqual(restore(delivered),delivered);
    assert.deepEqual(delivered.stocks,state.stocks); assert.deepEqual(delivered.movements,state.movements);
    const totals = courierPaymentTotals(courierHistory(delivered,'rudna',1));
    assert.equal(totals[method],order.total+50); assert.equal(totals.tips,50);
    if (method !== 'cash') assert.equal(totals.cash,0);
    assert.throws(()=>collectDemoPayment(delivered,order.id,'rudna',1,method,50,later),/probíhajícího/);
    assert.equal(order.courierPayment,undefined);
  }
});
test('Online orders charge only optional tips; an online order can still finish without a tip', () => {
  const state = fixture(), order = courierOrders(state,'rudna',1)[1];
  assert.deepEqual(courierPaymentQuote(order,'card',30),{method:'card',base:0,tip:30,amount:30});
  assert.throws(()=>collectDemoPayment(state,order.id,'rudna',1,'qr',0,later),/zaplacená online/);
  const paid = collectDemoPayment(state,order.id,'rudna',1,'card',30,later);
  const delivered = finishDelivery(paid,order.id,'rudna',1,false,later);
  assert.equal(courierHistory(delivered,'rudna',1)[0].courierDelivery.payment,'online');
  assert.deepEqual(courierPaymentTotals(courierHistory(delivered,'rudna',1)),{cash:0,card:30,qr:0,online:order.total,tips:30});
  assert.deepEqual(restore(delivered),delivered);
});
test('Payment validates tips, ownership, delivery stage, timing, and stored amount integrity', () => {
  const state = fixture(), [order,,ready] = courierOrders(state,'rudna',1);
  for (const tip of [-1,0.5,10001,NaN,Infinity,'50',null]) assert.throws(()=>courierPaymentQuote(order,'qr',tip),/Dýško/);
  assert.throws(()=>courierPaymentQuote(order,'online',0),/Vyberte/);
  for (const [b,c] of [['beroun',1],['rudna',2]]) assert.throws(()=>collectDemoPayment(state,order.id,b,c,'qr',0,later));
  assert.throws(()=>collectDemoPayment(state,ready.id,'rudna',1,'card',0,later),/probíhajícího/);
  const issue = setDeliveryIssue(state,order.id,'rudna',1,ISSUE_REASONS[0],later);
  assert.throws(()=>collectDemoPayment(issue,order.id,'rudna',1,'qr',0,later),/vyřešte/);
  assert.throws(()=>collectDemoPayment(state,order.id,'rudna',1,'card',0,'bad'),/Čas/);
  const paid = collectDemoPayment(state,order.id,'rudna',1,'qr',20,later);
  assert.throws(()=>finishDelivery(paid,order.id,'rudna',1,false,now),/předcházet/);
  for (const patch of [{tip:-1},{tip:undefined},{base:1},{amount:1},{demo:false},{method:'online'},{confirmedAt:'bad'},{confirmedAt:'2020-01-01'}]) {
    const broken = structuredClone(paid); Object.assign(broken.orders.find(o=>o.id===order.id).courierPayment,patch);
    assert.throws(()=>restore(broken));
  }
  const legacy = finishDelivery(state,order.id,'rudna',1,true,later);
  assert.deepEqual(courierPaymentTotals(courierHistory(legacy,'rudna',1)),{cash:order.total,card:0,qr:0,online:0,tips:0});
});
