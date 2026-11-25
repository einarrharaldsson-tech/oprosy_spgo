import L from 'leaflet';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import {
  clusterGeoPoints,
  collectGeoPoints,
  fragmentLabel,
} from './geoClusters';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * Wait until OSM tiles have finished loading (or timeout).
 * Tracks tileloadstart/tileload/tileerror so we don't snapshot a half-empty map.
 */
function waitForTileLayer(layer, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let pending = 0;
    let settled = false;
    let sawActivity = false;
    let idleTimer = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(hardStop);
      if (idleTimer) clearTimeout(idleTimer);
      layer.off('loading', onLoading);
      layer.off('load', onLoad);
      layer.off('tileloadstart', onTileStart);
      layer.off('tileload', onTileDone);
      layer.off('tileerror', onTileDone);
      resolve();
    };

    const scheduleIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      // Settle shortly after the last tile event / layer load.
      idleTimer = setTimeout(() => {
        if (pending <= 0) finish();
      }, 280);
    };

    const onLoading = () => {
      sawActivity = true;
    };
    const onLoad = () => {
      sawActivity = true;
      pending = 0;
      scheduleIdle();
    };
    const onTileStart = () => {
      sawActivity = true;
      pending += 1;
    };
    const onTileDone = () => {
      pending = Math.max(0, pending - 1);
      if (pending === 0) scheduleIdle();
    };

    layer.on('loading', onLoading);
    layer.on('load', onLoad);
    layer.on('tileloadstart', onTileStart);
    layer.on('tileload', onTileDone);
    layer.on('tileerror', onTileDone);

    const hardStop = setTimeout(finish, timeoutMs);
    // If tiles were already cached, 'load' may have fired before we subscribed —
    // give a short fallback wait.
    setTimeout(() => {
      if (!sawActivity && pending === 0) scheduleIdle();
    }, 400);
  });
}

async function canvasToPngBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/** Poll until Leaflet tile <img> nodes have decoded (or timeout). */
async function waitForTileImages(host, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const imgs = Array.from(host.querySelectorAll('.leaflet-tile-pane img'));
    if (imgs.length > 0 && imgs.every((img) => img.complete && img.naturalWidth > 0)) {
      await sleep(200);
      return;
    }
    await sleep(120);
  }
}

/**
 * Render an off-screen Leaflet map for a set of points and capture a PNG blob.
 * Host stays in the viewport (opacity:0) — tiles often fail to load when the
 * map is positioned far off-screen (common blank-map issue on Windows).
 */
export async function capturePointsMap(points, { width = 960, height = 540, pad = 0.4, maxZoom = 17 } = {}) {
  if (!points?.length) return null;

  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = [
    'position:fixed',
    'left:0',
    'top:0',
    `width:${width}px`,
    `height:${height}px`,
    'overflow:hidden',
    'background:#fff',
    'opacity:0',
    'pointer-events:none',
    'z-index:-1',
  ].join(';');
  document.body.appendChild(host);

  let map;
  try {
    map = L.map(host, {
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      preferCanvas: true,
      fadeAnimation: false,
      zoomAnimation: false,
      markerZoomAnimation: false,
    });

    const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      crossOrigin: true,
      updateWhenIdle: false,
      updateWhenZooming: false,
      keepBuffer: 4,
    }).addTo(map);

    const group = L.featureGroup();
    for (const p of points) {
      L.circleMarker([p.lat, p.lng], {
        radius: 7,
        color: '#0f3d3e',
        weight: 2,
        fillColor: '#c45c26',
        fillOpacity: 0.92,
      }).addTo(group);
    }
    group.addTo(map);

    map.invalidateSize(true);
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], Math.min(16, maxZoom), { animate: false });
    } else {
      map.fitBounds(group.getBounds().pad(pad), { animate: false, maxZoom });
    }
    map.invalidateSize(true);

    await sleep(120);
    map.invalidateSize(true);
    await waitForTileLayer(tiles, 10000);
    await waitForTileImages(host, 10000);
    await sleep(350);

    const { default: html2canvas } = await import('html2canvas');
    const target = host.querySelector('.leaflet-container') || host;
    const canvas = await html2canvas(target, {
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      scale: 2,
      logging: false,
      width,
      height,
      imageTimeout: 20000,
      onclone: (_doc, cloned) => {
        // Ensure tile images are visible in the clone (opacity/transitions).
        cloned.querySelectorAll('.leaflet-tile').forEach((el) => {
          el.style.opacity = '1';
          el.style.visibility = 'visible';
        });
      },
    });
    return canvasToPngBlob(canvas);
  } finally {
    try {
      map?.remove();
    } catch {
      /* ignore */
    }
    host.remove();
  }
}

/** Overview map snapshot for all geotags (same offscreen path as fragments). */
export async function captureOverviewMap(items, options = {}) {
  const points = collectGeoPoints(items);
  if (!points.length) return null;
  return capturePointsMap(points, {
    width: options.width || 1100,
    height: options.height || 620,
    pad: options.pad ?? 0.25,
    maxZoom: options.maxZoom || 15,
  });
}

/**
 * Build zoomed map fragment captures for the largest geotag clusters.
 * @returns {Promise<Array<{ image: Blob, label: string, count: number }>>}
 */
export async function captureGeoMapFragments(items, options = {}) {
  const {
    radiusM = 1800,
    minPoints = 2,
    maxClusters = 4,
    width = 960,
    height = 540,
  } = options;

  const points = collectGeoPoints(items);
  const clusters = clusterGeoPoints(points, { radiusM, minPoints, maxClusters });
  if (!clusters.length) return [];

  const fragments = [];
  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i];
    try {
      const image = await capturePointsMap(cluster.points, { width, height, pad: 0.45 });
      if (!image) continue;
      fragments.push({
        image,
        label: fragmentLabel(cluster, i),
        count: cluster.count,
      });
    } catch {
      // Skip a failed cluster capture; keep others.
    }
  }
  return fragments;
}

export { collectGeoPoints, clusterGeoPoints, fragmentLabel };
