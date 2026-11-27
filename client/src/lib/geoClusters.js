/**
 * Cluster survey geotags for zoomed "fragment" map captures.
 * Pure functions — safe to unit-test in Node.
 */

const EARTH_R_M = 6371000;

export function collectGeoPoints(items) {
  const points = [];
  for (const item of items || []) {
    const lat = Number(item?.geo?.lat);
    const lng = Number(item?.geo?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    points.push({
      id: item.id,
      sessionNumber: item.sessionNumber,
      lat,
      lng,
      conductorName: item.conductorName || '',
    });
  }
  return points;
}

/** Great-circle distance in metres. */
export function haversineMeters(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function boundsOf(points) {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  return { minLat, maxLat, minLng, maxLng };
}

function spanMeters(points) {
  if (!points.length) return 0;
  const b = boundsOf(points);
  const diag = haversineMeters(
    { lat: b.minLat, lng: b.minLng },
    { lat: b.maxLat, lng: b.maxLng }
  );
  return diag;
}

/**
 * Greedy distance clustering (single-linkage within radiusM).
 * Returns clusters sorted by size desc, each with { points, centroid }.
 */
export function clusterGeoPoints(
  points,
  { radiusM = 1800, minPoints = 2, maxClusters = 4 } = {}
) {
  const list = Array.isArray(points) ? points.filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng)) : [];
  if (list.length < minPoints) return [];

  const parent = list.map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const unite = (i, j) => {
    const a = find(i);
    const b = find(j);
    if (a !== b) parent[b] = a;
  };

  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (haversineMeters(list[i], list[j]) <= radiusM) unite(i, j);
    }
  }

  const buckets = new Map();
  for (let i = 0; i < list.length; i++) {
    const root = find(i);
    if (!buckets.has(root)) buckets.set(root, []);
    buckets.get(root).push(list[i]);
  }

  const overallSpan = spanMeters(list);
  const clusters = [...buckets.values()]
    .filter((pts) => pts.length >= minPoints)
    .map((pts) => {
      const lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
      const lng = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
      const span = spanMeters(pts);
      return {
        points: pts,
        centroid: { lat, lng },
        count: pts.length,
        spanM: span,
        // Prefer clusters that are meaningfully tighter than the full map.
        zoomRatio: overallSpan > 0 ? span / overallSpan : 1,
      };
    })
    // Keep only clusters that zoom in enough (or any if overview is tiny).
    .filter((c) => overallSpan < 800 || c.zoomRatio < 0.72)
    .sort((a, b) => b.count - a.count || a.spanM - b.spanM)
    .slice(0, maxClusters);

  return clusters;
}

export function fragmentLabel(cluster, index) {
  const n = cluster?.count || cluster?.points?.length || 0;
  return `Фрагмент ${index + 1} · ${n} ${pluralMetok(n)}`;
}

function pluralMetok(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'метка';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'метки';
  return 'меток';
}
