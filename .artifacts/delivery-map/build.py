from pathlib import Path
import json, re, base64, xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
SRC = HERE / 'source'
ns = {'k': 'http://www.opengis.net/kml/2.2'}

def published(slug):
    tree = ET.parse(SRC / f'visi-{slug}.kml')
    coords = tree.find('.//k:Polygon//k:coordinates', ns).text
    ring = [[float(v) for v in point.split(',')[:2]] for point in coords.split()]
    return {'type': 'FeatureCollection', 'features': [{'type': 'Feature', 'properties': {}, 'geometry': {'type': 'Polygon', 'coordinates': [ring]}}]}

def simplify(points, epsilon=0.00007):
    if len(points) < 3: return points
    a, b = points[0], points[-1]
    dx, dy = b[0]-a[0], b[1]-a[1]
    length = dx*dx+dy*dy
    def distance(p):
        t = max(0, min(1, ((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length)) if length else 0
        return ((p[0]-a[0]-t*dx)**2+(p[1]-a[1]-t*dy)**2)**0.5
    index, farthest = max(enumerate(points[1:-1], 1), key=lambda pair: distance(pair[1]))
    if distance(farthest) > epsilon:
        return simplify(points[:index+1], epsilon)[:-1]+simplify(points[index:], epsilon)
    return [a, b]

beroun = {'type': 'FeatureCollection', 'features': []}
places = []
for slug, name in [('visi-beroun-geo','Beroun'),('kraluv-dvur','Králův Dvůr'),('vraz','Vráž'),('hyskov','Hýskov'),('tetin','Tetín'),('trubin','Trubín'),('popovice','Popovice')]:
    item = json.loads((SRC / (slug+'.json')).read_text())[0]
    places.append({'name': name, 'point': [float(item['lat']), float(item['lon'])]})
    geo = item['geojson']
    if geo['type'] == 'Polygon':
        geo['coordinates'] = [simplify(r) for r in geo['coordinates']]
        beroun['features'].append({'type': 'Feature', 'properties': {'name': name}, 'geometry': geo})

data = [
 {'id':'rudna','name':'Rudná','letter':'R','color':'#ca6235','address':'Riegrova 527/50, Rudná','point':[50.0360741,14.2367666],'phone':'+420 606 918 942','kind':'published','geometry':published('rudna'),'places':[],
  'areas':['Rudná','Nučice','Chrášťany','Drahelčice','Úhonice','Tachlovice','Jinočany','Zbuzany','Vysoký Újezd','Praha-Zličín','Praha-Třebonice'],
  'source':'https://www.google.com/maps/d/viewer?mid=1DXi5GftFMRASLYRihN8_kZ1Xc4hwjS8',
  'platforms':{'wolt':'https://wolt.com/cs/cze/prague/restaurant/pizza-visi-rudna','foodora':'https://www.foodora.cz/en/restaurant/j6d7/pizzavisi-rudna','bolt':'https://food.bolt.eu/cs-cz/1000-kladno/p/149709-pizza-visi-rudna-u-prahy-own-delivery/'}},
 {'id':'hostivice','name':'Hostivice','letter':'H','color':'#187e7b','address':'Husovo náměstí 60, Hostivice','point':[50.0799443,14.2572491],'phone':'+420 606 518 565','kind':'published','geometry':published('hostivice'),'places':[],
  'areas':['Hostivice','Praha-Zličín','Praha-Řepy','Praha-Ruzyně','Jeneč','Hostouň','Dobrovíz','Kněževes','Středokluky','Svárov','Chýně','Červený Újezd','Praha-Sobín'],
  'source':'https://www.google.com/maps/d/viewer?mid=1hkCdCQFOTZqt6Fggz-c0Pkc5aAFfab4',
  'platforms':{'wolt':'https://wolt.com/cs/cze/prague/restaurant/pizza-visi-hostivice','foodora':None,'bolt':'https://food.bolt.eu/cs-cz/1000-kladno/p/149706-pizza-visi-hostivice-own-delivery/'}},
 {'id':'beroun','name':'Beroun','letter':'B','color':'#7260a8','address':'Pivovarská 105/11, Beroun','point':[49.9630527,14.0731013],'phone':'+420 737 857 493','kind':'approximate','geometry':beroun,'places':places,
  'areas':['Beroun','Králův Dvůr','Vráž','Hýskov','Tetín','Popovice','Trubín'],'source':'https://pizzavisi.cz/rozvoz/',
  'platforms':{'wolt':'https://wolt.com/en/cze/beroun-kraluv-dvur/restaurant/pizza-visi-beroun','foodora':'https://www.foodora.cz/en/restaurant/ye0r/pizzavisi-beroun-ye0r','bolt':None}}
]
fonts = (ROOT/'public/fonts.css').read_text()
fonts = re.sub(r'url\(\./assets/fonts/([^\)]+)\)',lambda m: 'url(data:font/woff2;base64,'+base64.b64encode((ROOT/'public/assets/fonts'/m[1]).read_bytes()).decode()+')',fonts)
css = (SRC/'visi-leaflet.css').read_text()
# No relative image assets: the map uses custom vector/div markers and no layer-control sprites.
css = re.sub(r'url\(images/[^)]+\)', 'none', css)
js = re.sub(r'//# sourceMappingURL=.*', '', (SRC/'visi-leaflet.js').read_text())
html = (HERE/'template.html').read_text().replace('/* EMBED_FONTS */',fonts).replace('/* EMBED_LEAFLET_CSS */',css).replace('/* EMBED_LEAFLET_JS */',js).replace('/* EMBED_DATA */',json.dumps(data,ensure_ascii=False,separators=(',',':')))
out = ROOT/'public/mapa-rozvozu.html'
html = html.replace('</head>', '<!--\nLeaflet license\n'+(SRC/'leaflet-LICENSE.txt').read_text()+'\n-->\n</head>')
out.write_text(html)
print(f'{out}: {out.stat().st_size:,} bytes')
print('Geometry vertices:',[(d['id'],sum(len(r) for f in d['geometry']['features'] for r in f['geometry']['coordinates'])) for d in data])
