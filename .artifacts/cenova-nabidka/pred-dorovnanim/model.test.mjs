import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {parsePrice,computeQuote} from './model.mjs';
const data=JSON.parse(readFileSync(new URL('./data.json',import.meta.url)));
const values=Object.fromEntries([...data.work.map(w=>[w.key,String(w.price)]),...data.hardware.flatMap(w=>[[w.key+'Qty',String(w.qty)],[w.key+'Price',String(w.price)]]),...Object.entries(data.operating).map(([k,v])=>[k,String(v)])]);
test('Czech amounts, missing price distinct from zero and invalid values rejected',()=>{
 assert.equal(parsePrice('1 234,50 Kč'),123450);assert.equal(parsePrice(''),null);assert.equal(parsePrice('0'),0);
 for(const s of ['-1','12x','0.001','1e3'])assert.throws(()=>parsePrice(s));assert.throws(()=>parsePrice('1,5',true));
});
test('baseline one-time and monthly quote, whole network server only once',()=>{
 const r=computeQuote(data,values);assert.equal(r.work,2450000);assert.equal(r.hardware,7490100);assert.equal(r.total,9940100);
 assert.equal(r.op.online,283500);assert.equal(r.op.terminal,204000);assert.equal(r.op.total,732500);assert.equal(r.op.withPlatforms,12545000);assert.equal(r.op.unknownApi,true);
});
test('hardware quantities propagate to SIM and app fees, not development cost',()=>{
 const r=computeQuote(data,{...values,driverDeviceQty:'6'});assert.equal(r.work,2450000);assert.equal(r.op.sim,90000);assert.equal(r.op.appFee,30000);assert.equal(r.op.total,792500);
});
test('gateway threshold; empty API remains unknown, explicit zero resolves it',()=>{
 for(const [volume,fee]of [['100000',110000],['100001',100001]])assert.equal(computeQuote(data,{...values,onlineVolume:volume}).op.online,fee);
 assert.equal(computeQuote(data,{...values,apiMonthly:'0'}).op.unknownApi,false);
 assert.equal(computeQuote(data,{...values,terminalVolume:'0'}).op.appFee,0);
});
test('incomplete and inconsistent quotes are never final totals',()=>{
 assert.equal(computeQuote(data,{...values,pos:''}).incomplete,true);
 assert.equal(computeQuote(data,{...values,onlineVolume:''}).op,null);
 assert.throws(()=>computeQuote(data,{...values,driverDeviceQty:'0'}));
 assert.throws(()=>computeQuote(data,{...values,platformRate:'101'}));
});
