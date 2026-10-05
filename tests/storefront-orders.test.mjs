import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createState, restoreState, requirements, transitionOrder, STORAGE_KEY } from '../public/admin/model.js';
import { createStorefrontOrder, submitLocalOrder } from '../public/storefront-orders.js';
import { resolveAddress, searchAddresses } from '../public/ruian-addresses.js';

const json = async path => JSON.parse(await readFile(new URL(path, import.meta.url)));
const [data, seed, addresses] = await Promise.all([json('../public/data/site.json'), json('../public/admin/seed.json'), json('../public/data/ruian-addresses.json')]);
const now = '2026-10-05T10:00:00Z';
const address = resolveAddress(addresses, '6348416');
const input = () => ({data, branchId:'rudna', fulfillment:'delivery', addressId:address.id, idempotencyKey:'test-order-request-0001', customer:{name:'Test zákazník',phone:'777 123 456',email:'test@example.com',note:'Zavolat u dveří',payment:'cash',address:address.label},cart:[{itemId:'1-margherita',size:40,quantity:2,extras:['mozzarella','mozzarellove-okraje','cesnekova-50g'],note:'Prosím rozkrájet'}]});
const initial = () => createState(data, seed, now);

test('Storefront order preserves 40cm, all add-ons, notes, totals and canonical address in POS after reload',()=>{
 const before=initial(),request=input(),result=createStorefrontOrder(before,request,addresses,now);
 assert.equal(result.order.source,'web'); assert.equal(result.order.total,851); assert.equal(result.order.subtotal,760); assert.equal(result.order.packaging,46);
 assert.equal(result.order.lines[0].size,40); assert.equal(result.order.lines[0].unitPrice,380); assert.equal(result.order.lines[0].extras.length,3); assert.equal(result.order.lines[0].note,'Prosím rozkrájet');
 assert.equal(result.order.addressSnapshot.id,address.id); assert.equal(result.order.addressSnapshot.sourceDate,'2026-08-31'); assert.equal(result.order.deliveryAddress,address.label); assert.equal(result.order.email,'test@example.com');
 assert.equal(result.order.inventoryIncomplete,true); assert.equal(result.order.payment,'cash'); assert.equal(result.order.status,'new'); assert.equal(result.order.deduction,null);
 assert.equal(before.orders.length,0); assert.deepEqual(result.state.stocks,before.stocks);
 assert.deepEqual(restoreState(JSON.stringify(result.state),data,seed).orders[0],result.order);
 assert.throws(()=>requirements(result.state,result.order,seed,now),/receptura/);
 const confirmed=transitionOrder(result.state,result.order.id,'confirmed',seed,now);
 assert.equal(confirmed.orders[0].status,'confirmed');
 assert.throws(()=>transitionOrder(confirmed,result.order.id,'preparing',seed,now),/receptura/);
 assert.deepEqual(confirmed.stocks,before.stocks);
});

test('A retry returns the same order while changed payload cannot reuse its request ID',()=>{
 const request=input(),first=createStorefrontOrder(initial(),request,addresses,now),again=createStorefrontOrder(first.state,request,addresses,now);
 assert.equal(again.duplicate,true); assert.equal(again.state,first.state); assert.equal(again.order.id,first.order.id); assert.equal(again.state.orders.length,1);
 request.cart[0].quantity=3;
 assert.throws(()=>createStorefrontOrder(first.state,request,addresses,now),/jinými údaji/);
});

test('Standalone sauces keep quantity, catalog prices and pizza-only packaging through checkout and POS reload',()=>{
 const request=input();
 request.cart=[{itemId:'1-margherita',size:30,quantity:1,extras:[]}];
 for(const sauce of data.categories.find(category=>category.id==='omacky').items){
  request.cart.push({itemId:sauce.id,size:null,quantity:2,extras:[]});
 }
 const result=createStorefrontOrder(initial(),request,addresses,now);
 assert.equal(result.order.subtotal,360);
 assert.equal(result.order.packaging,16);
 assert.equal(result.order.total,421);
 assert.equal(result.order.lines.length,4);
 assert.ok(result.order.lines.slice(1).every(line=>line.size===null&&line.quantity===2&&line.unitPrice===35));
 assert.deepEqual(restoreState(JSON.stringify(result.state),data,seed).orders[0],result.order);
 const pizzaOnly=createStorefrontOrder(initial(),{...input(),cart:request.cart.slice(0,1)},addresses,now);
 assert.deepEqual(requirements(result.state,result.order,seed,now),requirements(pizzaOnly.state,pizzaOnly.order,seed,now));
});

test('Beroun delivery retains its canonical address and branch through the POS roundtrip',()=>{
 const canonical=searchAddresses(addresses,'Beroun Pivovarska 105').find(address=>address.branchIds.includes('beroun'));
 assert.ok(canonical);
 const request=input();request.branchId='beroun';request.addressId=canonical.id;request.customer.address=canonical.label;
 const result=createStorefrontOrder(initial(),request,addresses,now);
 assert.match(result.order.id,/^VISI-BER-/);
 assert.equal(result.order.branchId,'beroun');
 assert.equal(result.order.addressSnapshot.id,canonical.id);
 assert.equal(result.order.deliveryAddress,canonical.label);
 assert.deepEqual(restoreState(JSON.stringify(result.state),data,seed).orders[0],result.order);
 request.branchId='rudna';
 assert.throws(()=>createStorefrontOrder(initial(),request,addresses,now),/nerozváží/);
});

test('Arbitrary or edited addresses, uncovered branches, fake online payments and invalid cart lines are rejected',()=>{
 for(const change of [r=>r.addressId=null,r=>r.addressId='999999999',r=>r.customer.address+=' jinak',r=>r.branchId='beroun',r=>r.customer.payment='applepay',r=>r.cart[0].extras.push('fake-addon'),r=>r.cart[0].quantity=21,r=>r.cart[0].size=50,r=>r.cart[0].itemId='grana-padano']){
  const request=input(),state=initial();change(request);assert.throws(()=>createStorefrontOrder(state,request,addresses,now));assert.equal(state.orders.length,0);
 }
 const pickup=input();pickup.fulfillment='pickup';pickup.branchId='beroun';pickup.addressId=null;pickup.customer.address='';
 assert.equal(createStorefrontOrder(initial(),pickup,null,now).order.total,806);
});

test('Persistence must succeed before checkout can receive a success result',async()=>{
 const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
 const deps={storage,locks:null,now:()=>now,loadSeed:async()=>seed,loadAddresses:async()=>addresses};
 const request=input(),result=await submitLocalOrder(request,deps),again=await submitLocalOrder(request,deps);
 assert.equal(result.orderId,again.orderId);assert.equal(result.total,851);assert.equal(JSON.parse(values.get(STORAGE_KEY)).orders.length,1);
 const broken={getItem:()=>null,setItem:()=>{throw new Error('Quota exceeded')}};
 await assert.rejects(()=>submitLocalOrder({...input(),idempotencyKey:'different-request-0002'},{...deps,storage:broken}),/Quota/);
 assert.equal(request.cart.length,1);
});

test('New web orders include their branch code and survive reload alongside legacy IDs',()=>{
 let state=initial();
 for(const [branchId,code] of [['rudna','RUD'],['hostivice','HOST'],['beroun','BER']]){
  const request={...input(),branchId,fulfillment:'pickup',addressId:null,idempotencyKey:`branch-request-${branchId}`};
  const result=createStorefrontOrder(state,request,null,now);
  assert.equal(result.order.id,`VISI-${code}-${state.sequence+1}`);
  state=restoreState(JSON.stringify(result.state),data,seed);
 }
 const legacy=structuredClone(state.orders[0]);
 legacy.id='VISI-1000'; delete legacy.webRequest;
 state.orders.push(legacy);
 assert.equal(restoreState(JSON.stringify(state),data,seed).orders.length,4);
 const mismatched=structuredClone(state); mismatched.orders[0].id='VISI-RUD-1043';
 assert.throws(()=>restoreState(JSON.stringify(mismatched),data,seed),/neplatná/);
 const continued=createStorefrontOrder(state,{...input(),idempotencyKey:'after-reload-request'},addresses,now);
 assert.equal(continued.order.id,'VISI-RUD-1044');
});
