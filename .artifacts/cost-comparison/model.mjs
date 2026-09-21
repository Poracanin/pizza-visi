export const defaults = {
  daily:30, days:30, basket:350, woltShare:20, foodoraShare:20, boltShare:10,
  woltRate:25, foodoraRate:25, boltRate:25, webShare:30, otherCards:0,
  license:1990, server:1200, hardware:17990, currentExtra:null, newExtra:null,
  ownHardware:null, setup:null, monthlyPrice:null
};
export function calculate(x) {
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
