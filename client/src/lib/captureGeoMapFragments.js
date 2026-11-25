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

function waitForTileLayer(layer, timeoutMs = 4500) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      layer.off('load', onLoad);
      resolve();
    };
    const onLoad = () => {
      window.setTimeout(finish, 180);
    };
    layer.on('load', onLoad);
    window.setTimeout(finish, timeoutMs);
  });
}

async function canvasToPngBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/**
 * Render an off-screen Leaflet map for a set of points and capture a PNG blob.
 */
async function capturePointsMap(points, { width = 960, height = 540, pad = 0.4 } = {}) {
  if (!points?.length) return null;

  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = [
    'position:fixed',
    'left:-12000px',
    'top:0',
    `width:${width}px`,
    `height:${height}px`,
    'overflow:hidden',
    'background:#fff',
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
    });

    const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      crossOrigin: true,
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
      map.setView([points[0].lat, points[0].lng], 16);
    } else {
      map.fitBounds(group.getBounds().pad(pad), { animate: false, maxZoom: 17 });
    }
    map.invalidateSize(true);
    await waitForTileLayer(tiles);
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
