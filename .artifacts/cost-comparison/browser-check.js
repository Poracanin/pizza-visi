
const defaults = {
  daily:30, days:30, basket:350, woltShare:20, foodoraShare:20, boltShare:10,
  woltRate:25, foodoraRate:25, boltRate:25, webShare:30, otherCards:0,
  license:1990, server:1200, hardware:17990, currentExtra:null, newExtra:null,
  ownHardware:null, setup:null, monthlyPrice:null
};
function calculate(x) {
  for (const [key,value] of Object.entries(x)) {
    if (value !== null && (!Number.isFinite(value) || value < 0)) throw new Error('Zadej nezáporná čísla.');
  }
  if (x.days > 31 || x.basket <= 0) throw new Error('Měsíc má nejvýše 31 dní a hodnota objednávky musí být kladná.');
  const shares = x.woltShare + x.foodoraShare + x.boltShare + x.webShare;
  if (shares > 100 + 1e-9) throw new Error('Podíly kanálů přesahují 100 %. Sniž podíl některého z nich.');
  if ([x.woltRate,x.foodoraRate,x.boltRate,x.otherCards].some(v=>v>100)) throw new Error('Sazba ani podíl karet nesmí přesáhnout 100 %.');
  const orders = x.daily * x.days * 3;
  const turnover = orders * x.basket;
  const channels = ['wolt','foodora','bolt'].map(key=>({
    key, orders:orders*x[key+'Share']/100, turnover:turnover*x[key+'Share']/100,
    fee:turnover*x[key+'Share']/100*x[key+'Rate']/100
  }));
  const commissions = channels.reduce((a,c)=>a+c.fee,0);
  const webOrders = orders * x.webShare/100;
  const webTurnover = webOrders * x.basket;
  const gatewayFixed = webTurnover > 100000 ? 0 : 100;
  const gatewayVariable = webTurnover * (0.01 + 0.01*x.otherCards/100);
  const gateway = gatewayVariable + gatewayFixed;
  const license = 3*x.license;
  const technical = x.server+gateway;
  const oldKnown = license+commissions+(x.currentExtra??0);
  const newKnown = technical+commissions+(x.newExtra??0);
  const hardware = 3*x.hardware;
  const ownHardware = x.ownHardware===null ? null : 3*x.ownHardware;
  const ownInitial = ownHardware===null || x.setup===null ? null : ownHardware+x.setup;
  const clientMonthly = x.monthlyPrice===null ? null : x.monthlyPrice+gateway+commissions+(x.newExtra??0);
  return {orders,turnover,channels,commissions,webOrders,webTurnover,gatewayFixed,gatewayVariable,gateway,
    license,technical,oldKnown,newKnown,hardware,ownHardware,ownInitial,clientMonthly,
    fixedDifference:license-x.server, remaining:license-technical, otherShare:100-shares,
    oldYear:oldKnown*12+hardware,
    newYearKnown:newKnown*12+(ownHardware??0)+(x.setup??0),
    clientYear:clientMonthly===null || ownInitial===null ? null : clientMonthly*12+ownInitial
  };
}

const $=id=>document.getElementById(id);
const money=v=>new Intl.NumberFormat('cs-CZ',{style:'currency',currency:'CZK',maximumFractionDigits:2}).format(v);
const num=v=>new Intl.NumberFormat('cs-CZ',{maximumFractionDigits:1}).format(v);
const names={wolt:'Wolt',foodora:'Foodora',bolt:'Bolt Food'};
const colors={wolt:'#089fc0',foodora:'#dd237b',bolt:'#219763'};
const maybe=v=>v===null?'<span class="unknown">Nezadáno</span>':money(v);
const row=(label,a,b,cls='')=>`<tr class="${cls}"><td>${label}</td><td class="money">${a}</td><td class="money">${b}</td></tr>`;
const storageKey='pizza-visi-cost-model-v1';
$('platform-inputs').innerHTML=Object.keys(names).map(k=>`<div class="channel-label"><strong><i class="dot" style="--color:${colors[k]}"></i>${names[k]}</strong><span class="tag estimate">Odhad</span></div><div class="channel-fields"><label class="field"><span>Podíl ${names[k]} · %</span><input id="${k}Share" type="number" min="0" max="100" value="${defaults[k+'Share']}"></label><label class="field"><span>Provize ${names[k]} · %</span><input id="${k}Rate" type="number" min="0" max="100" step="0.1" value="25"></label></div>`).join('');
function readInputs(){const x={};for(const [k,d] of Object.entries(defaults)){const el=$(k);x[k]=el.value.trim()===''?null:Number(el.value);if(x[k]===null&&d!==null)throw new Error('Vyplň objednávky, sazby, licenci, server a cenu obnovy Dotykačky.');}return x;}
function setInputs(x){for(const k of Object.keys(defaults))$(k).value=x[k]??'';syncPresets();}
function syncPresets(){for(const [key,values] of [['license',['1990','1691.5','1385.5']],['hardware',['17990','14990']]])$(key+'Preset').value=values.includes($(key).value)?$(key).value:'custom';}
function render(){
 let x,r;try{x=readInputs();r=calculate(x);$('error').hidden=true;$('results').classList.remove('invalid');}
 catch(e){$('error').textContent=e.message+' Výsledky níže zůstávají z posledního platného zadání.';$('error').hidden=false;$('results').classList.add('invalid');return;}
 $('assumption-text').textContent=`${num(x.daily)} objednávek × ${num(x.days)} dní × 3 pobočky, průměrný účet ${money(x.basket)}. `;
 $('license-kpi').textContent=money(r.license);$('license-caption').textContent=`3 × ${money(x.license)}. ${x.license===1691.5||x.license===1385.5?'Roční předplatné rozpočítané na měsíce.':'Měsíční náklad podle zadané sazby.'}`;
 $('own-kpi').textContent=money(r.technical);$('hardware-kpi').textContent=money(r.hardware);$('hardware-caption').textContent=`3 × ${money(x.hardware)} bez DPH. ${x.hardware===17990?'15,6″ komplet s tiskárnou.':x.hardware===14990?'15,6″ bez nové tiskárny.':'Zadaný rozpočet zařízení.'}`;
 $('other-share').textContent=num(r.otherShare)+' %';
 const platformRows=r.channels.map(c=>row(`<i class="dot" style="--color:${colors[c.key]}"></i>${names[c.key]}<small>${num(c.orders)} objednávek · ${money(c.turnover)} × ${num(x[c.key+'Rate'])} %</small>`,money(c.fee),money(c.fee))).join('');
 $('monthly-table').innerHTML=row('Dotykačka NEOMEZENĚ<small>3 licence; vlastní varianta počítá s plnou náhradou</small>',money(r.license),money(0))+row('Společný server vlastního systému<small>Jednou pro všechny tři pobočky</small>','—',money(x.server))+platformRows+row('Comgate · platby z vlastního webu<small>'+num(r.webOrders)+' plateb / '+money(r.webTurnover)+'; paušál '+money(r.gatewayFixed)+'</small>','<span class="unknown">Dnešní brána níže</span>',money(r.gateway))+row('Další externí poplatky<small>Fyzické terminály, stávající platby, doplňky, API a jiné služby dle smluv</small>',maybe(x.currentExtra),maybe(x.newExtra))+row('Součet spočtených položek<small>Nezjištěné položky ani tvoje práce nejsou zahrnuté</small>',money(r.oldKnown),money(r.newKnown),'subtotal');
 const max=Math.max(r.license,r.technical,1);$('old-bar').style.width=(r.license/max*100)+'%';$('new-bar').style.width=(r.technical/max*100)+'%';$('old-bar-value').textContent=money(r.license);$('new-bar-value').textContent=money(r.technical);
 $('fixed-insight').textContent=`Rozdíl mezi licencemi a samotným serverem: ${money(r.fixedDifference)} měsíčně (${money(r.fixedDifference*12)} ročně).`;
 $('remaining-insight').textContent=r.remaining>=0?`Po přidání nové brány zbývá ${money(r.remaining)} měsíčně do výše dnešních licencí. Je to prostor před tvým servisem a dalšími poplatky, ne potvrzená úspora. Dnešní platební poplatky zatím neznáme.`:`Server s novou bránou převyšuje dnešní licence o ${money(-r.remaining)} měsíčně. Dnešní platební poplatky zatím neznáme, takže samotný rozdíl není srovnáním celkových výdajů.`;
 $('branch-table').innerHTML=['Rudná','Hostivice','Beroun'].map(n=>`<tr><td>${n}<small>Modelový průměr</small></td><td class="money">${num(r.orders/3)}</td><td class="money">${money(r.turnover/3)}</td><td class="money">${money(x.license)}</td></tr>`).join('')+`<tr class="subtotal"><td>Celkem</td><td class="money">${num(r.orders)}</td><td class="money">${money(r.turnover)}</td><td class="money">${money(r.license)}</td></tr>`;
 $('branch-notes').innerHTML=`Server v průměru ${money(x.server/3)} / pobočka, brána ${money(r.gateway/3)} / pobočka a provize ${money(r.commissions/3)} / pobočka. Server a brána se však skutečně účtují společně za celou síť.`;
 $('hardware-table').innerHTML=row('Nové hlavní POS · 3 kusy<small>Jedna pokladna na každou pobočku</small>',money(r.hardware),maybe(r.ownHardware))+row('Vývoj, API, migrace a školení<small>Jednorázová cena tvého nasazení pro celou síť</small>','<span class="unknown">Instalace dle nabídky</span>',maybe(x.setup))+row('Vyčíslené zařízení / vlastní nasazení',money(r.hardware),r.ownInitial===null?'<span class="unknown">Rozpočet není kompletní</span>':money(r.ownInitial),'subtotal');
 $('hardware-note').innerHTML=`Vybraná obnova Dotykačky: <strong>${money(r.hardware)} bez DPH / ${money(r.hardware*1.21)} s 21% DPH</strong>. Nezahrnuje instalaci, případnou pokladní zásuvku, zákaznický displej ani další kuchyňské tiskárny.`;
 $('scenario-table').innerHTML=[20,30,50].map(d=>{const s=calculate({...x,daily:d});return `<tr${x.daily===d?' class="subtotal"':''}><td>${d} / pobočka<small>${num(s.orders)} objednávek celkem / měsíc</small></td><td class="money">${money(s.commissions)}</td><td class="money">${money(s.gateway)}</td><td class="money">${money(s.technical)}</td></tr>`;}).join('');
 document.querySelectorAll('[data-daily]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.daily)===x.daily)));
 $('year-table').innerHTML=row('12 měsíců spočtených nákladů',money(r.oldKnown*12),money(r.newKnown*12))+row('Nová zařízení',money(r.hardware),maybe(r.ownHardware))+row('Tvoje nasazení','<span class="unknown">—</span>',maybe(x.setup))+row('Mezisoučet prvního roku',money(r.oldYear),money(r.newYearKnown),'subtotal');
 $('year-notes').innerHTML=`<strong>Nejde o konečnou cenu přechodu.</strong> ${r.ownInitial===null?'Vlastní hardware a/nebo nasazení nejsou zadané a v mezisoučtu chybí. ':''}Vlastní varianta zde zahrnuje server, ne tvůj servisní paušál. ${x.currentExtra===null||x.newExtra===null?'Část externích poplatků není zadaná. ':''}Roční předplatné může znamenat platbu předem; model nesleduje splatnosti ani případný souběh obou systémů.`;
 $('quote-fee').textContent=x.monthlyPrice===null?'Doplnit cenu':money(x.monthlyPrice);
 $('quote-total').textContent=r.clientMonthly===null?'Zatím nelze dopočítat':money(r.clientMonthly)+(x.newExtra===null?' + nezjištěné poplatky':'');
 $('quote-note').textContent=x.monthlyPrice===null?`Provozní základ bez platformních provizí je ${money(r.technical)} měsíčně. Zadej v části „Další náklady a tvoje cena“ paušál včetně serveru. Bránu a provize potom přičteme pouze jednou.`:`Tvůj paušál ${money(x.monthlyPrice)} nahrazuje server ${money(x.server)}. Rozdíl ${money(x.monthlyPrice-x.server)} ještě musí pokrýt tvou práci a náklady obsažené v paušálu; není to čistý zisk. ${r.clientYear===null?'Pro první rok doplň také cenu POS a nasazení.':'Klientův první rok: '+money(r.clientYear)+(x.newExtra===null?' + nezjištěné poplatky.':'.')}`;
 try{localStorage.setItem(storageKey,JSON.stringify(x));}catch{$('save-note').textContent='Úložiště prohlížeče není dostupné. Změny platí po dobu otevření stránky.';}
}
try{const saved=JSON.parse(localStorage.getItem(storageKey)||'null');if(saved&&typeof saved==='object')setInputs({...defaults,...Object.fromEntries(Object.entries(saved).filter(([k])=>k in defaults))});}catch{}
for(const k of Object.keys(defaults))$(k).addEventListener('input',()=>{syncPresets();render();});
for(const key of ['license','hardware'])$(key+'Preset').addEventListener('change',()=>{const v=$(key+'Preset').value;if(v!=='custom'){$(key).value=v;render();}else $(key).focus();});
document.querySelectorAll('[data-daily]').forEach(b=>b.addEventListener('click',()=>{$('daily').value=b.dataset.daily;render();}));
$('equal-hardware').addEventListener('click',()=>{$('ownHardware').value=$('hardware').value;render();});
$('reset').addEventListener('click',()=>{setInputs(defaults);render();});
$('print').addEventListener('click',()=>window.print());
render();
