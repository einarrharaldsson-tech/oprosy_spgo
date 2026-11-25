/**
 * Smoke test for geotag clustering used by HTML deck map fragments.
 * Usage: node scripts/test-geo-clusters.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(ROOT, 'client/src/lib/geoClusters.js');
const mod = await import(pathToFileURL(src).href);

const { clusterGeoPoints, collectGeoPoints, fragmentLabel, haversineMeters } = mod;

const nearA = [
  { id: 1, sessionNumber: 1, lat: 56.31, lng: 38.13 },
  { id: 2, sessionNumber: 2, lat: 56.311, lng: 38.131 },
  { id: 3, sessionNumber: 3, lat: 56.3095, lng: 38.129 },
];
const nearB = [
  { id: 4, sessionNumber: 4, lat: 56.45, lng: 38.4 },
  { id: 5, sessionNumber: 5, lat: 56.451, lng: 38.401 },
  { id: 6, sessionNumber: 6, lat: 56.449, lng: 38.399 },
];
const lonely = [{ id: 7, sessionNumber: 7, lat: 56.0, lng: 37.5 }];

const items = [...nearA, ...nearB, ...lonely].map((p) => ({
  id: p.id,
  sessionNumber: p.sessionNumber,
  geo: { lat: p.lat, lng: p.lng },
}));

const points = collectGeoPoints(items);
const clusters = clusterGeoPoints(points, { radiusM: 1800, minPoints: 2, maxClusters: 4 });

const distGroups = haversineMeters(nearA[0], nearB[0]);
const ok =
  points.length === 7 &&
  clusters.length === 2 &&
  clusters[0].count >= 3 &&
  clusters[1].count >= 3 &&
  distGroups > 5000 &&
  /Фрагмент 1/.test(fragmentLabel(clusters[0], 0));

const out = {
  ok,
  points: points.length,
  clusters: clusters.map((c) => ({ count: c.count, zoomRatio: Number(c.zoomRatio.toFixed(3)) })),
  distAB_km: Number((distGroups / 1000).toFixed(2)),
  label: fragmentLabel(clusters[0], 0),
};

console.log(JSON.stringify(out, null, 2));
if (!ok) process.exit(1);

// silence unused
void fs;
