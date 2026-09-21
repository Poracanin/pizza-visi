import './assets/vendor/leaflet/leaflet.js';

// Fixed public demo destinations. No customer addresses are geocoded by this page.
const POINTS = {
  'Masarykova 94/53, Rudná': [50.0337952,14.2321981],
  'Riegerova 527/50, Rudná': [50.0360741,14.2367666],
  '5. května 583, Rudná': [50.0256688,14.2122000],
  'Husovo náměstí 13, Hostivice': [50.0805013,14.2555613],
  'Husovo náměstí 1702, Hostivice': [50.0803688,14.2542975],
  'Husovo náměstí 60, Hostivice': [50.0799443,14.2572491],
  'Pod Kaplankou 21, Beroun': [49.9646000,14.0696156],
  'Pivovarská 105/11, Beroun': [49.9630527,14.0731013]
};
const instances = new Map();
export const hasSampleMap = address => Object.hasOwn(POINTS, address || '');
export function clearSampleMaps(root) {
  for (const [element,map] of instances) if (root.contains(element)) { map.remove(); instances.delete(element); }
}
export function mountSampleMaps(root) {
  const L = window.L;
  for (const element of root.querySelectorAll('[data-sample-map]')) {
    const address = element.dataset.sampleMap;
    if (instances.has(element) || !hasSampleMap(address)) continue;
    const point = POINTS[address];
    const map = L.map(element, {scrollWheelZoom:false,dragging:!L.Browser.mobile,zoomControl:false}).setView(point,16);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>'
    }).addTo(map);
    L.control.zoom({position:'topright',zoomInTitle:'Přiblížit mapu',zoomOutTitle:'Oddálit mapu'}).addTo(map);
    L.marker(point, {title:address,alt:'Ukázková zastávka: '+address,icon:L.divIcon({className:'courier-map-pin',html:'<span></span>',iconSize:[30,38],iconAnchor:[15,38]})}).addTo(map);
    instances.set(element,map);
    map.invalidateSize();
  }
}
