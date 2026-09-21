import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createState, createDemoState, addOrder, transitionOrder, restock, saveRecipe, saveRecipeCells, requirements, restoreState, pizzas} from '../public/admin/model.js';
import {stockSummary, localDay, validDay, batchStatus, updateBatch, discardBatch} from '../public/admin/inventory.js';
const site = JSON.parse(fs.readFileSync(new URL('../public/data/site.json', import.meta.url)));
const seed = JSON.parse(fs.readFileSync(new URL('../public/admin/seed.json', import.meta.url)));
const now = '2026-09-21T10:00:00.000Z';
const initial = () => createState(site, seed, now);
const meta = (expiresOn = '2026-10-05') => ({lot: 'TEST-01', receivedOn: '2026-09-21', expiresOn, note: 'Test příjmu'});
const input = (lines = [{pizzaId:'1-margherita',size:30,quantity:2}], overrides = {}) => ({branchId:'rudna',source:'wolt',fulfillment:'pickup',payment:'online',lines,...overrides});
const order = (state=initial(), lines, overrides) => addOrder(state,site,input(lines,overrides),now);
function empty(state,id='mozzarella') { state.stocks.rudna[id]=0; for (const b of state.batches) if(b.branchId==='rudna'&&b.ingredientId===id)b.remaining=0; return state; }
const start = created => transitionOrder(created.state,created.order.id,'preparing',seed,now);
const saved = state => restoreState(JSON.stringify(state),site,seed);

test('24 receptur používá pouze 30 cm, všechny suroviny mají šarži a stav se obnoví',()=>{
 const state=initial(); assert.equal(pizzas(site).length,24);assert.equal(seed.ingredients.length,32);
 for(const p of pizzas(site)){assert.deepEqual(Object.keys(state.recipes[p.id]),['30']);assert.ok(state.recipes[p.id][30].testo);const c=order(state,[{pizzaId:p.id,size:30,quantity:1}]);assert.ok(requirements(state,c.order,seed,now).every(i=>!i.missing));}
 assert.deepEqual(saved(state),state);
 assert.throws(()=>order(state,[{pizzaId:'1-margherita',size:40,quantity:1}]));
 assert.throws(()=>saveRecipe(state,site,seed,'1-margherita',40,{testo:100}));
});
test('Vytvoření a potvrzení nic neodečtou; příprava agreguje počty a více pizz',()=>{
 const state=initial(),c=order(state,[{pizzaId:'1-margherita',size:30,quantity:2},{pizzaId:'2-sunkova',size:30,quantity:3}]);
 const confirmed=transitionOrder(c.state,c.order.id,'confirmed',seed,now);assert.deepEqual(confirmed.stocks,state.stocks);
 const prepared=start({state:confirmed,order:c.order});assert.equal(state.stocks.rudna.mozzarella-prepared.stocks.rudna.mozzarella,500);
 assert.equal(prepared.movements.length,1);assert.equal(prepared.orders[0].deduction.amounts.mozzarella,500);
 assert.equal(prepared.orders[0].deduction.allocations.filter(a=>a.ingredientId==='mozzarella').reduce((s,a)=>s+a.quantity,0),500);
 assert.deepEqual(prepared.stocks.beroun,state.stocks.beroun);assert.deepEqual(saved(prepared),prepared);
});
test('Nedostatek dostupné suroviny nezmění objednávku ani jinou šarži',()=>{
 const c=order(empty(initial()));const before=structuredClone(c.state);
 assert.throws(()=>start(c),/Nedostatek surovin.*Mozzarella/);assert.deepEqual(c.state,before);
});
test('Opakované zahájení, reload a další stavy neodečtou podruhé',()=>{
 const c=order();let state=start(c);const snapshot=structuredClone(state);
 assert.equal(transitionOrder(state,c.order.id,'preparing',seed,now),state);
 state=transitionOrder(saved(state),c.order.id,'ready',seed,now);
 assert.throws(()=>transitionOrder(state,c.order.id,'preparing',seed,now));
 state=transitionOrder(state,c.order.id,'completed',seed,now);
 assert.deepEqual(state.stocks,snapshot.stocks);assert.deepEqual(state.batches,snapshot.batches);assert.equal(state.movements.length,1);
});
test('Naskladnění vytvoří šarži, zvýší pouze příslušnou pobočku a uchová datum příjmu',()=>{
 const state=restock(empty(initial()),seed,'rudna','mozzarella',1000,meta(),now);
 assert.equal(state.stocks.rudna.mozzarella,1000);assert.equal(state.stocks.beroun.mozzarella,5000);
 assert.equal(stockSummary(state,'rudna','mozzarella',now).lastReceived,'2026-09-21');
 assert.equal(start(order(state)).stocks.rudna.mozzarella,800);assert.doesNotThrow(()=>saved(state));
 for(const amount of [0,-1,1.5,NaN,Infinity,10000001])assert.throws(()=>restock(state,seed,'rudna','mozzarella',amount,meta(),now));
});
test('FEFO vydá nejbližší trvanlivost a rozdělí výdej mezi šarže',()=>{
 let state=empty(initial());state=restock(state,seed,'rudna','mozzarella',500,meta('2026-10-10'),now);const later=state.batches.at(-1).id;
 state=restock(state,seed,'rudna','mozzarella',120,meta('2026-09-22'),now);const sooner=state.batches.at(-1).id;
 const prepared=start(order(state));assert.equal(prepared.batches.find(b=>b.id===sooner).remaining,0);assert.equal(prepared.batches.find(b=>b.id===later).remaining,420);
 const allocations=prepared.orders[0].deduction.allocations.filter(a=>a.ingredientId==='mozzarella');assert.deepEqual(allocations.map(a=>a.quantity),[120,80]);assert.deepEqual(allocations.map(a=>a.batchId),[sooner,later]);
});
test('Poslední příjem vychází i z opraveného data šarže a ne ze dne zadání',()=>{
 let state=createState(site,seed,'2026-09-01T10:00:00Z');
 state=restock(state,seed,'rudna','mozzarella',1000,{...meta(),receivedOn:'2026-09-20'},now);
 const revised=updateBatch(state,state.batches.at(-1).id,{lot:'OPRAVA',receivedOn:'2026-09-18',expiresOn:'2026-10-05'},now);
 assert.equal(stockSummary(revised,'rudna','mozzarella',now).lastReceived,'2026-09-18');
 assert.equal(stockSummary(revised,'beroun','mozzarella',now).lastReceived,'2026-09-01');
});
test('Prošlé a nedatované zásoby jsou v celku, ale nelze je vydat do přípravy',()=>{
 const state=initial(),b=state.batches.find(b=>b.branchId==='rudna'&&b.ingredientId==='mozzarella');b.receivedOn='2026-09-01';b.expiresOn='2026-09-20';
 let q=stockSummary(state,'rudna','mozzarella',now);assert.equal(q.total,5000);assert.equal(q.available,0);assert.equal(q.expired,5000);assert.throws(()=>start(order(state)),/Nedostatek/);
 b.expiresOn=null;q=stockSummary(state,'rudna','mozzarella',now);assert.equal(q.undated,5000);assert.equal(q.available,0);
 assert.throws(()=>start(order(state)),/Nedostatek/);assert.doesNotThrow(()=>saved(state));
});
test('Spotřeba dnes je použitelná, po půlnoci v Praze se šarže zablokuje',()=>{
 const b={remaining:100,expiresOn:'2026-09-21'};
 assert.equal(localDay('2026-09-21T21:59:00Z'),'2026-09-21');assert.equal(batchStatus(b,'2026-09-21T21:59:00Z'),'soon');
 assert.equal(localDay('2026-09-21T22:00:00Z'),'2026-09-22');assert.equal(batchStatus(b,'2026-09-21T22:00:00Z'),'expired');
});
test('Nepřijme nemožná data a spotřebu před příjmem, datum prošlé zásoby lze evidovat',()=>{
 assert.equal(validDay('2026-02-30'),false);assert.equal(validDay('2028-02-29'),true);
 for(const data of [{...meta(),expiresOn:''},{...meta(),receivedOn:'2026-09-22'},{...meta(),expiresOn:'2026-09-20'},{...meta(),expiresOn:'2026-02-30'}])assert.throws(()=>restock(initial(),seed,'rudna','mozzarella',100,data,now));
 const state=restock(initial(),seed,'rudna','mozzarella',100,{...meta('2026-09-20'),receivedOn:'2026-09-01'},now);assert.equal(stockSummary(state,'rudna','mozzarella',now).expired,100);
});
test('Úprava metadat a vyřazení šarže vytvoří audit bez přepsání dřívějšího výdeje',()=>{
 const c=order(),state=start(c),b=state.batches.find(b=>b.branchId==='rudna'&&b.ingredientId==='mozzarella');
 const revised=updateBatch(state,b.id,{lot:'OPRAVA',receivedOn:'2026-09-21',expiresOn:'2026-09-23'},now);
 assert.deepEqual(revised.orders[0].deduction,state.orders[0].deduction);assert.deepEqual(revised.stocks,state.stocks);assert.equal(revised.movements[0].type,'correction');
 const discarded=discardBatch(revised,b.id,'Prošlé',now);assert.equal(discarded.stocks.rudna.mozzarella,0);assert.equal(discarded.movements[0].type,'waste');assert.equal(discarded.movements[0].amounts.mozzarella,4800);
 assert.throws(()=>discardBatch(discarded,b.id,'Znovu',now));assert.doesNotThrow(()=>saved(discarded));
});
test('Změny tabulky receptur jsou atomické, historická spotřeba se nemění',()=>{
 const c=order(),state=start(c);
 const changed=saveRecipeCells(state,site,seed,[{pizzaId:'1-margherita',ingredientId:'mozzarella',before:100,amount:125},{pizzaId:'2-sunkova',ingredientId:'testo',before:250,amount:260}]);
 assert.equal(changed.orders[0].deduction.amounts.mozzarella,200);assert.equal(start(order(changed)).orders[0].deduction.amounts.mozzarella,250);assert.deepEqual(changed.stocks,state.stocks);
 const before=structuredClone(state);assert.throws(()=>saveRecipeCells(state,site,seed,[{pizzaId:'1-margherita',ingredientId:'mozzarella',before:100,amount:125},{pizzaId:'2-sunkova',ingredientId:'testo',before:250,amount:-1}]));assert.deepEqual(state,before);
});
test('Tabulka odmítne prázdný řádek i souběžný konflikt a dovolí změnit nezávislou buňku',()=>{
 const state=initial();assert.throws(()=>saveRecipeCells(state,site,seed,Object.entries(state.recipes['1-margherita'][30]).map(([ingredientId,before])=>({pizzaId:'1-margherita',ingredientId,before,amount:0}))));
 assert.throws(()=>saveRecipeCells(state,site,seed,[{pizzaId:'1-margherita',ingredientId:'mozzarella',before:80,amount:125}]),/jiné okno/);
 assert.doesNotThrow(()=>saveRecipeCells(state,site,seed,[{pizzaId:'1-margherita',ingredientId:'mozzarella',before:100,amount:125}]));
});
test('Zrušení před přípravou nemění sklad a po přípravě není dovoleno',()=>{
 const c=order();assert.deepEqual(transitionOrder(c.state,c.order.id,'cancelled',seed,now).stocks,c.state.stocks);assert.throws(()=>transitionOrder(start(c),c.order.id,'cancelled',seed,now));
});
test('Kanály zůstávají oddělené a nápoj nemění ingredience ani krabice',()=>{
 const demo=createDemoState(site,seed);assert.equal(demo.orders.length,21);assert.deepEqual([...new Set(demo.orders.map(o=>o.source))].sort(),['bolt','foodora','pos','web','wolt']);assert.doesNotThrow(()=>saved(demo));
 const c=order(initial(),[{pizzaId:'nestea-zeleny-caj-0-5l',size:null,quantity:2}],{source:'pos'});assert.equal(c.order.total,100);const state=start(c);assert.deepEqual(state.stocks,c.state.stocks);assert.deepEqual(state.batches,c.state.batches);assert.doesNotThrow(()=>saved(state));
});
test('Migrace původních dat zachová stav a historický výdej; neznámá trvanlivost zůstane neznámá',()=>{
 const c=order(),old=start(c);old.version=1;delete old.batches;delete old.batchSequence;
 for(const recipe of Object.values(old.recipes))recipe[40]={...recipe[30]};
 old.orders[0].lines[0].size=40;delete old.orders[0].deduction.allocations;
 const pending=order(initial(),undefined,{source:'pos'}).order;pending.id='VISI-2000';pending.lines[0].size=40;pending.lines[0].unitPrice=220;old.orders.push(pending);old.sequence=2000;
 const migrated=saved(old);assert.equal(migrated.version,2);assert.deepEqual(migrated.stocks,old.stocks);assert.deepEqual(migrated.orders[0].deduction,old.orders[0].deduction);assert.equal(migrated.orders[0].lines[0].size,40);
 assert.equal(migrated.orders[1].lines[0].size,30);assert.equal(migrated.orders[1].total,332);assert.equal(stockSummary(migrated,'rudna','mozzarella',now).undated,4800);assert.equal(stockSummary(migrated,'rudna','mozzarella',now).available,0);assert.doesNotThrow(()=>saved(migrated));
});
test('Poškozené údaje se neobnoví, součet šarží musí souhlasit se skladem',()=>{
 assert.throws(()=>restoreState('{invalid',site,seed));const state=initial();state.batches[0].remaining--;assert.throws(()=>saved(state),/Součet šarží/);
 const c=order(),bad=start(c);bad.orders[0].deduction=null;assert.throws(()=>saved(bad));
});
