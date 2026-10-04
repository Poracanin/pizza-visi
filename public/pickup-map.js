import './assets/vendor/leaflet/leaflet.js';

// Public branch coordinates only; no customer address is sent to the map provider.
export function mountPickupMap(element, branch) {
  const L = window.L;
  const map = L.map(element, {
    scrollWheelZoom: false, dragging: !L.Browser.mobile,
    touchZoom: false, zoomControl: false, attributionControl: false
  }).setView(branch.coordinates, 16);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>'
  }).addTo(map);
  L.control.attribution({ prefix: false }).addTo(map);
  L.control.zoom({ position: 'topright', zoomInTitle: 'Přiblížit mapu', zoomOutTitle: 'Oddálit mapu' }).addTo(map);
  L.marker(branch.coordinates, {
    title: `Pizza Visi ${branch.name}`, alt: `Pizza Visi ${branch.name}`,
    icon: L.divIcon({ className: 'pickup-map-marker', html: '<span></span>', iconSize: [28, 36], iconAnchor: [14, 36] })
  }).addTo(map);
  const size = new ResizeObserver(() => map.invalidateSize({ pan: false }));
  size.observe(element);
  return () => { size.disconnect(); map.remove(); };
}
