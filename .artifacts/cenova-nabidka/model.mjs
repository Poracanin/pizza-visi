export function parsePrice(raw,integer=false){
 const s=String(raw??'').trim().replace(/[\s\u00a0\u202f]/g,'').replace(/Kč$/i,'').replace(',','.');
 if(!s)return null;
 if(!(integer?/^\d+$/:/^\d+(\.\d{1,2})?$/).test(s))throw new Error('Zadejte nezápornou částku, nejvýše se dvěma desetinnými místy. Počet kusů musí být celé číslo.');
 const n=Number(s);if(n>9999999)throw new Error('Zadaná hodnota je příliš vysoká.');return integer?n:Math.round(n*100);
}
export function computeQuote(data,values){
 const p=(k,int=false)=>parsePrice(values[k],int);
 const workRows=data.work.map(w=>({key:w.key,total:w.included?0:p(w.key)}));
 const hwRows=data.hardware.map(w=>{const qty=p(w.key+'Qty',true),unit=p(w.key+'Price');return{key:w.key,qty,unit,total:qty===null||unit===null?null:qty*unit};});
 const sum=rows=>rows.reduce((a,r)=>a+(r.total??0),0);
 const work=sum(workRows),hardware=sum(hwRows);
 const incomplete=[...workRows,...hwRows].some(r=>r.total===null);
 const v=Object.fromEntries(Object.keys(data.operating).map(k=>[k,p(k)]));
 const apps=hwRows.find(r=>r.key==='driverDevice').qty;
 const opReady=apps!==null&&Object.entries(v).every(([k,n])=>k==='apiMonthly'||n!==null);
 if(v.platformRate!==null&&v.platformRate>10000)throw new Error('Provize nesmí přesahovat 100 %.');
 if(apps===0&&v.terminalVolume>0)throw new Error('Pro platby přes řidičské terminály je potřeba zadat alespoň jeden terminál.');
 let op=null;
 if(opReady){
  const online=Math.round(v.onlineVolume/100)+(v.onlineVolume>10000000?0:10000);
  // Budget conservatively includes all active-app fees; actual volume waivers may reduce them.
  const appFee=v.terminalVolume===0?0:apps*5000;
  const terminal=Math.round(v.terminalVolume/100)+appFee;
  const sim=apps*v.simPrice;
  const platforms=Math.round(v.platformVolume*v.platformRate/10000);
  const total=v.server+v.support+sim+v.other+online+terminal+(v.apiMonthly??0);
  op={...v,online,terminal,appFee,sim,platforms,total,withPlatforms:total+platforms,unknownApi:v.apiMonthly===null};
 }
 const workReady=workRows.every(r=>r.total!==null),hardwareReady=hwRows.every(r=>r.total!==null);
 // Allocate in cents, keeping the final branch as the rounding remainder.
 const split=(total,weights)=>{const sum=weights.reduce((a,n)=>a+n,0);let assigned=0;return weights.map((w,i)=>{const n=i===weights.length-1?total-assigned:Math.round(total*w/sum);assigned+=n;return n;});};
 const workParts=split(work,[data.reference.firstBranch,data.reference.nextBranch,data.reference.nextBranch]);
 const hardwareParts=split(hardware,[1,1,1]);
 const deposit=workReady?Math.round(work*.2):null;
 const deposits=deposit===null?[null,null,null]:split(deposit,workParts.some(n=>n>0)?workParts:[1,1,1]);
 const branches=['Rudná','Hostivice','Beroun'].map((name,i)=>({name,work:workReady?workParts[i]:null,hardware:hardwareReady?hardwareParts[i]:null,total:incomplete?null:workParts[i]+hardwareParts[i],deposit:deposits[i]}));
 const payments={deposit,balance:workReady?work-deposit:null,hardware:hardwareReady?hardware:null,hardwareGross:hardwareReady?Math.round(hardware*1.21):null};
 return{workRows,hwRows,work,hardware,hardwareGross:Math.round(hardware*1.21),total:work+hardware,incomplete,op,branches,payments};
}
