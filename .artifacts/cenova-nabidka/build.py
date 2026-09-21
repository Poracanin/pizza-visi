from pathlib import Path
import json,html
here=Path(__file__).resolve().parent
root=here.parents[1]
d=json.loads((here/'data.json').read_text())
def m(n):return f'{n:,.2f}'.replace(',',' ').replace('.',',').removesuffix(',00')+' Kč'
def field(key,label,group='',price=None):
 if price is None: price=d['operating'].get(key,'')
 val=str(price).replace('.',',')
 return f'<div class="money-field"><input data-field="{key}" value="{html.escape(val,quote=True)}" aria-label="{label}" inputmode="decimal" maxlength="14" placeholder="K doplnění" autocomplete="off"><span class="currency">Kč</span></div><span class="price-display" data-price="{key}">{m(price) if price!="" else "K doplnění"}</span>'
work=''
for i,w in enumerate(d['work'],1):
 cost='<strong class="included-price">0 Kč · zdarma</strong>' if w.get('included') else field(w['key'],'Cena: '+w['name'],price=w['price'])
 work+=f'<tr><th scope="row"><span class="number">{i:02}</span>{w["name"]}</th><td>{w["scope"]}</td><td class="cost-cell">{cost}</td></tr>'
hardware=''
for i,h in enumerate(d['hardware'],1):
 key=h['key']
 product_link=f'<a class="device-link" href="{html.escape(h["source"],quote=True)}" target="_blank" rel="noopener noreferrer" aria-label="Zobrazit produkt: {html.escape(h["name"],quote=True)} (nová karta)">Zobrazit produkt ↗</a>' if h.get('source') else ''
 hardware+=f'<tr><th scope="row"><span class="number">{i:02}</span>{h["name"]}{product_link}</th><td>{h["scope"]}<span class="kind">{h["kind"]}</span></td><td class="cost-cell"><strong class="product-total" id="total-{key}">{m(h["qty"]*h["price"])}</strong><span class="calculation" id="calc-{key}">{h["qty"]} ks × {m(h["price"])}</span><div class="qty-controls"><label>Počet<input data-field="{key}Qty" value="{h["qty"]}" inputmode="numeric" maxlength="6" aria-label="Počet: {h["name"]}"></label><label>Kč / kus<input data-field="{key}Price" value="{h["price"]}" inputmode="decimal" maxlength="14" aria-label="Cena za kus: {h["name"]}"></label></div></td></tr>'
scenario=''
for key,label in [('onlineVolume','Platby kartou na webu · Kč / měsíc'),('terminalVolume','Platby přes mobilní terminály · Kč / měsíc'),('platformVolume','Objem objednávek platforem · Kč / měsíc'),('platformRate','Modelová provize platforem · %')]:
 v=d['operating'][key]
 scenario+=f'<label>{label}<input data-field="{key}" value="{v}" inputmode="decimal" maxlength="14"><span class="scenario-value" data-op-value="{key}">{str(v)+" %" if key=="platformRate" else m(v)}</span></label>'
values={w['key']:str(w['price']) for w in d['work']}
for h in d['hardware']:
 values[h['key']+'Qty']=str(h['qty']);values[h['key']+'Price']=str(h['price'])
values.update({k:str(v) for k,v in d['operating'].items()})
seed={'id':d['id'],'data':d,'values':values}
t=(here/'template.html').read_text().replace('/* REFERENCE_CSS */',(here/'reference.css').read_text()).replace('<!-- WORK_ROWS -->',work).replace('<!-- HARDWARE_ROWS -->',hardware).replace('<!-- SCENARIO_FIELDS -->',scenario)
for key,label in [('server','Server měsíčně pro celou síť'),('support','Správa měsíčně pro celou síť'),('simPrice','Datová SIM měsíčně za zařízení'),('other','Ostatní služby měsíčně pro celou síť'),('apiMonthly','Externí API poplatky měsíčně')]:
 t=t.replace('<!-- FIELD_'+key+' -->',field(key,label))
t=t.replace('/* SEED */',json.dumps(seed,ensure_ascii=False).replace('<','\\u003c')).replace('/* MODEL */',(here/'model.mjs').read_text().replace('export function ','function '))
(root/'public/cenova-nabidka.html').write_text(t)
print('Vytvořeno public/cenova-nabidka.html')
