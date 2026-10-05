const BRANCH_COLORS = { rudna: '#cc2545', hostivice: '#087b78', beroun: '#865ab4' };
const mountedMaps = new WeakMap();
let mapSequence = 0;

export function setDeliveryMapBranch(container, branchId = 'all') {
  return mountedMaps.get(container)?.selectBranch(branchId) ?? false;
}

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);

export function filterDeliveryAreas(features, branchId = 'all') {
  return branchId === 'all' ? features : features.filter((feature) => feature.properties.branchIds.includes(branchId));
}

function areaCount(count) {
  return `${count} ${count === 1 ? 'oblast' : count > 1 && count < 5 ? 'oblasti' : 'oblastí'}`;
}

/** Mount once; the map library, boundaries and tiles load only near the viewport. */
export function initDeliveryMap(container, branches) {
  if (!container) return () => {};
  if (mountedMaps.has(container)) return mountedMaps.get(container).cleanup;
  const mapBranches = branches.filter((branch) => BRANCH_COLORS[branch.id]);
  const branchById = new Map(mapBranches.map((branch) => [branch.id, branch]));
  const patternId = `delivery-shared-${++mapSequence}`;
  const abortController = new AbortController();
  let map;
  let coverage;
  let markers;
  let data;
  let activeBranch = 'all';
  let loading = false;
  let destroyed = false;
  let resizeObserver;
  let visibilityObserver;
  let pendingFit = false;
  let lastWidth = 0;
  let lastHeight = 0;

  container.classList.add('delivery-coverage-map');
  container.innerHTML = `
    <div class="delivery-map-toolbar">
      <div class="delivery-map-filters" role="group" aria-label="Zobrazit rozvoz podle pobočky">
        <button type="button" class="delivery-map-filter" data-map-branch="all" aria-pressed="true" aria-label="Všechny pobočky"><span>Všechny<span class="delivery-map-all-suffix"> pobočky</span></span></button>
        ${mapBranches.map((branch) => `<button type="button" class="delivery-map-filter" data-map-branch="${escapeHtml(branch.id)}" aria-pressed="false" style="--branch-color:${BRANCH_COLORS[branch.id]}"><i aria-hidden="true"></i>${escapeHtml(branch.name)}</button>`).join('')}
      </div>
      <button type="button" class="delivery-map-fit" disabled aria-label="Zobrazit celou vybranou oblast rozvozu" title="Zobrazit celou oblast"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5M8 8l-5-5M16 8l5-5M8 16l-5 5M16 16l5 5"/></svg><span>Celá oblast</span></button>
    </div>
    <div class="delivery-map-stage">
      <div class="delivery-map-canvas" aria-label="Mapa oblastí rozvozu Pizza Visi"></div>
      <div class="delivery-map-loading" role="status"><span class="delivery-map-loading-mark" aria-hidden="true"></span><span>Načítáme mapu rozvozu…</span></div>
      <div class="delivery-map-error" hidden role="status"><strong>Mapu se nepodařilo načíst.</strong><span>Lokality rozvozu najdeš v přehledu pod mapou.</span><button type="button" class="delivery-map-retry">Zkusit znovu</button></div>
      <p class="delivery-map-tile-note" role="status" hidden>Podklad mapy není úplný. Oblasti rozvozu zůstávají viditelné.</p>
    </div>
    <div class="delivery-map-summary" hidden></div>
    <div class="delivery-map-footer"><p>Orientační mapa. Přesnou adresu ověř výše.</p><span class="delivery-map-shared"><i aria-hidden="true"></i>Zličín: Rudná i Hostivice</span></div>
    <p class="sr-only delivery-map-status" aria-live="polite" aria-atomic="true"></p>`;

  const canvas = container.querySelector('.delivery-map-canvas');
  const loadingState = container.querySelector('.delivery-map-loading');
  const errorState = container.querySelector('.delivery-map-error');
  const fitButton = container.querySelector('.delivery-map-fit');
  const tileNote = container.querySelector('.delivery-map-tile-note');
  const summary = container.querySelector('.delivery-map-summary');
  const status = container.querySelector('.delivery-map-status');

  function updateSummary() {
    const selected = activeBranch === 'all' ? mapBranches : [branchById.get(activeBranch)];
    summary.classList.toggle('is-single', selected.length === 1);
    summary.innerHTML = selected.map((branch) => `<div class="delivery-map-branch" style="--branch-color:${BRANCH_COLORS[branch.id]}">
      <span class="delivery-map-branch-dot" aria-hidden="true"></span>
      <div><strong>${escapeHtml(branch.name)}</strong><span>${escapeHtml(branch.address)}</span></div>
      ${selected.length === 1 ? `<a href="${escapeHtml(branch.phone_uri)}" class="delivery-map-phone" aria-label="Zavolat pobočce ${escapeHtml(branch.name)}">${escapeHtml(branch.phone)}</a>` : ''}
    </div>`).join('');
    const count = data ? areaCount(filterDeliveryAreas(data.features, activeBranch).length) : null;
    status.textContent = activeBranch === 'all'
      ? `Zobrazeny všechny pobočky${count ? `, ${count}` : ''}. Zličín obsluhují Rudná i Hostivice.`
      : `Zobrazen rozvoz pobočky ${branchById.get(activeBranch).name}${count ? `, ${count}` : ''}.`;
  }

  function fitCoverage() {
    if (!map || !coverage) return;
    if (!canvas.clientWidth) { pendingFit = true; return; }
    pendingFit = false;
    lastWidth = canvas.clientWidth;
    lastHeight = canvas.clientHeight;
    const bounds = coverage.getBounds();
    markers.eachLayer((marker) => bounds.extend(marker.getLatLng()));
    if (bounds.isValid()) map.fitBounds(bounds, {
      paddingTopLeft: [28, 35], paddingBottomRight: [28, 40],
      maxZoom: 12, animate: false
    });
  }

  function popupForArea(feature) {
    const popup = document.createElement('div');
    const names = feature.properties.branchIds.map((id) => branchById.get(id)?.name).filter(Boolean);
    popup.className = 'delivery-map-popup';
    popup.innerHTML = `<strong>${escapeHtml(feature.properties.name)}</strong><span>${names.length > 1 ? 'Rozvoz z poboček' : 'Rozvoz z pobočky'} ${escapeHtml(names.join(' a '))}</span>`;
    return popup;
  }

  function addSharedPattern() {
    const svg = canvas.querySelector('.leaflet-overlay-pane svg');
    if (!svg || svg.querySelector(`#${patternId}`)) return;
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = `<pattern id="${patternId}" patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(35)"><rect width="5" height="10" fill="${BRANCH_COLORS.rudna}"/><rect x="5" width="5" height="10" fill="${BRANCH_COLORS.hostivice}"/></pattern>`;
    svg.prepend(defs);
  }

  function drawCoverage() {
    if (!map || !data) return;
    const L = window.L;
    map.closePopup();
    if (coverage) map.removeLayer(coverage);
    if (markers) map.removeLayer(markers);
    const features = filterDeliveryAreas(data.features, activeBranch);
    coverage = L.geoJSON(features, {
      style(feature) {
        const ids = feature.properties.branchIds;
        const shared = ids.length > 1 && activeBranch === 'all';
        const color = BRANCH_COLORS[activeBranch === 'all' ? ids[0] : activeBranch];
        return {
          color: shared ? '#54505b' : color, fillColor: shared ? `url(#${patternId})` : color,
          fillOpacity: shared ? 0.36 : 0.2, weight: 2, opacity: 0.9,
          dashArray: shared ? '5 3' : null
        };
      },
      onEachFeature(feature, layer) {
        const label = document.createElement('span');
        label.textContent = feature.properties.name;
        layer.bindTooltip(label, { sticky: true, direction: 'top', className: 'delivery-map-area-label' });
        layer.bindPopup(popupForArea(feature), { className: 'delivery-map-popup-shell', maxWidth: 250 });
        layer.on('mouseover', () => layer.setStyle({ fillOpacity: 0.4, weight: 3 }));
        layer.on('mouseout', () => coverage.resetStyle(layer));
      }
    }).addTo(map);
    markers = L.featureGroup().addTo(map);
    mapBranches.filter((branch) => activeBranch === 'all' || branch.id === activeBranch).forEach((branch) => {
      const marker = L.marker(branch.coordinates, {
        title: `Pizza Visi ${branch.name}`, alt: `Pobočka Pizza Visi ${branch.name}`, riseOnHover: true,
        icon: L.divIcon({
          className: 'delivery-map-pin',
          html: `<span style="--branch-color:${BRANCH_COLORS[branch.id]}" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 9h16l-1-5H5L4 9Zm1 0v11h14V9M9 20v-7h6v7M3 9c0 2 3 3 4 0 1 3 4 3 5 0 1 3 4 3 5 0 1 3 4 2 4 0"/></svg></span>`,
          iconSize: [34, 39], iconAnchor: [17, 39], tooltipAnchor: [0, 3], popupAnchor: [0, -37]
        })
      }).addTo(markers);
      const label = document.createElement('span');
      label.textContent = branch.name;
      marker.bindTooltip(label, { permanent: true, direction: 'bottom', className: 'delivery-map-branch-label', opacity: 1 });
      const popup = document.createElement('div');
      popup.className = 'delivery-map-popup';
      popup.innerHTML = `<strong>Pizza Visi ${escapeHtml(branch.name)}</strong><span>${escapeHtml(branch.address)}</span><a href="${escapeHtml(branch.phone_uri)}">Zavolat ${escapeHtml(branch.phone)}</a>`;
      marker.bindPopup(popup, { className: 'delivery-map-popup-shell', maxWidth: 250 });
    });
    fitCoverage();
    addSharedPattern();
    updateSummary();
  }

  function refreshSize() {
    if (!map || !canvas.clientWidth || !canvas.clientHeight) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const sizeChanged = Math.abs(width - lastWidth) > 1 || Math.abs(height - lastHeight) > 1;
    map.invalidateSize({ pan: false });
    if (pendingFit || sizeChanged) fitCoverage();
  }

  async function loadMap() {
    if (loading || map || destroyed) return;
    loading = true;
    loadingState.hidden = false;
    errorState.hidden = true;
    try {
      const [, response] = await Promise.all([
        import('./assets/vendor/leaflet/leaflet.js'),
        fetch(new URL('./data/delivery-areas.geojson', import.meta.url), { signal: abortController.signal })
      ]);
      if (!response.ok) throw new Error('Delivery areas unavailable');
      const collection = await response.json();
      if (collection.type !== 'FeatureCollection' || !Array.isArray(collection.features) || !collection.features.length ||
        collection.features.some((feature) => !['Polygon', 'MultiPolygon'].includes(feature.geometry?.type) ||
          !Array.isArray(feature.properties?.branchIds) || !feature.properties.branchIds.length ||
          feature.properties.branchIds.some((id) => !branchById.has(id)))) throw new Error('Invalid delivery areas');
      if (destroyed) return;
      data = collection;
      const L = window.L;
      map = L.map(canvas, {
        scrollWheelZoom: false, dragging: true, touchZoom: true,
        doubleClickZoom: true, boxZoom: false,
        zoomControl: false, attributionControl: false, minZoom: 9, maxZoom: 16,
        zoomSnap: 0.25, maxBoundsViscosity: 0.7
      }).setView([50.04, 14.17], 10);
      const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
        errorTileUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="256" height="256"/%3E'
      });
      let tileErrors = 0;
      tiles.on('loading', () => { tileErrors = 0; });
      tiles.on('tileerror', () => { tileErrors += 1; tileNote.hidden = false; });
      tiles.on('load', () => { tileNote.hidden = tileErrors === 0; });
      tiles.addTo(map);
      const attribution = L.control.attribution({ prefix: false }).addTo(map);
      attribution.addAttribution('Hranice: <a href="https://ags.cuzk.gov.cz/arcgis/rest/services/RUIAN/MapServer" target="_blank" rel="noopener noreferrer">ČÚZK, RÚIAN</a> (<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>, zjednodušeno)');
      L.control.zoom({ position: 'topright', zoomInTitle: 'Přiblížit mapu', zoomOutTitle: 'Oddálit mapu' }).addTo(map);
      drawCoverage();
      fitButton.disabled = false;
      loadingState.hidden = true;
      if ('ResizeObserver' in window) {
        resizeObserver = new ResizeObserver(refreshSize);
        resizeObserver.observe(canvas);
      } else window.addEventListener('resize', refreshSize);
    } catch (error) {
      if (destroyed || error.name === 'AbortError') return;
      if (map) { map.remove(); map = null; }
      loadingState.hidden = true;
      errorState.hidden = false;
      status.textContent = 'Mapu se nepodařilo načíst. Seznam lokalit rozvozu najdeš v přehledu pod mapou.';
    } finally {
      loading = false;
    }
  }

  function selectBranch(branchId) {
    if (branchId !== 'all' && !branchById.has(branchId)) return false;
    if (activeBranch === branchId) return true;
    activeBranch = branchId;
    container.querySelectorAll('[data-map-branch]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.mapBranch === branchId)));
    drawCoverage();
    updateSummary();
    return true;
  }

  function handleClick(event) {
    const filter = event.target.closest('[data-map-branch]');
    if (filter && container.contains(filter)) selectBranch(filter.dataset.mapBranch);
    else if (event.target.closest('.delivery-map-fit')) fitCoverage();
    else if (event.target.closest('.delivery-map-retry')) loadMap();
  }

  container.addEventListener('click', handleClick);
  updateSummary();
  if ('IntersectionObserver' in window) {
    visibilityObserver = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        visibilityObserver.disconnect();
        loadMap();
      }
    }, { rootMargin: '250px' });
    visibilityObserver.observe(container);
  } else loadMap();

  const cleanup = () => {
    destroyed = true;
    abortController.abort();
    visibilityObserver?.disconnect();
    resizeObserver?.disconnect();
    window.removeEventListener('resize', refreshSize);
    container.removeEventListener('click', handleClick);
    map?.remove();
    mountedMaps.delete(container);
  };
  mountedMaps.set(container, { cleanup, selectBranch });
  return cleanup;
}
