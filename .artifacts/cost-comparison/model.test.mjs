import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults,calculate} from './model.mjs';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} ≠ ${b}`);
test('30 orders per day × 30 days × 3 branches; server charged only once',()=>{
  const r=calculate(defaults);
  assert.equal(r.orders,2700); assert.equal(r.turnover,945000);
  assert.equal(r.commissions,118125); assert.equal(r.license,5970);
  assert.equal(r.webOrders,810); assert.equal(r.gateway,2835);
  assert.equal(r.technical,4035); assert.equal(r.oldKnown,124095);
  assert.equal(r.newKnown,122160); assert.equal(r.hardware,53970);
  assert.equal(r.fixedDifference,4770); assert.equal(r.remaining,1935);
  assert.equal(r.clientMonthly,null); assert.equal(r.ownInitial,null);
});
test('marketplace orders are never processed by Comgate; platform commissions remain',()=>{
  const r=calculate({...defaults,webShare:0,woltShare:100,foodoraShare:0,boltShare:0});
  assert.equal(r.gatewayVariable,0); assert.equal(r.gatewayFixed,100);
  assert.equal(r.commissions,236250); assert.equal(r.webOrders,0);
});
test('one shared gateway fee, waived strictly above 100000 CZK',()=>{
  for (const [basket,fixed] of [[99999,100],[100000,100],[100001,0]]) {
    const r=calculate({...defaults,daily:1,days:1,basket,webShare:100/3,woltShare:0,foodoraShare:0,boltShare:0});
    assert.equal(r.gatewayFixed,fixed);
  }
});
test('annual license price is amortized once; card mix affects only gateway',()=>{
  const r=calculate({...defaults,license:1691.5,otherCards:10});
  near(r.license,5074.5); near(r.gateway,3118.5); assert.equal(r.commissions,118125);
});
test('customer quote includes server, never adds it twice; upfront unknown is not zero',()=>{
  let r=calculate({...defaults,monthlyPrice:6000,ownHardware:10000,setup:100000,newExtra:500});
  assert.equal(r.clientMonthly,127460); assert.equal(r.ownInitial,130000);
  assert.equal(r.clientYear,1659520);
  r=calculate({...defaults,monthlyPrice:0,ownHardware:0,setup:0});
  assert.equal(r.ownInitial,0); assert.equal(r.clientMonthly,120960);
});
test('reject invalid shares, rates and negative values',()=>{
  for(const override of [{webShare:70},{woltRate:101},{server:-1},{basket:0},{days:32},{daily:NaN}]) {
    assert.throws(()=>calculate({...defaults,...override}));
  }
});
