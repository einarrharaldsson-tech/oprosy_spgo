import { getToken } from '../api.js';
import { getApiBase } from './paths.js';
import { planBasemap } from './osmTileMath.js';

async function fetchTile(tile) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${getApiBase()}/osm-tiles/${tile.z}/${tile.x}/${tile.y}`, { headers });
  if (!res.ok) throw new Error('tile');
  const blob = await res.blob();
  return createImageBitmap(blob);
}

function drawMarker(ctx, marker) {
  const radius = 16;
  ctx.beginPath();
  ctx.arc(marker.x, marker.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = '#1a5c5e';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(marker.n ?? ''), marker.x, marker.y + 1);
}

function drawAttribution(ctx, width, height) {
  const label = '© OpenStreetMap';
  ctx.font = '12px sans-serif';
  const padX = 8;
  const textW = ctx.measureText(label).width;
  const boxW = textW + padX * 2;
  const boxH = 20;
  const x = width - boxW - 8;
  const y = height - boxH - 8;
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.fillRect(x, y, boxW, boxH);
  ctx.fillStyle = '#334155';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + padX, y + boxH / 2);
}

/** PNG data URL of the points on an OpenStreetMap basemap. */
export async function renderOsmBasemap(points, cssWidth, cssHeight) {
  const width = Math.max(320, Math.round(cssWidth * 2));
  const height = Math.max(220, Math.round(cssHeight * 2));
  const plan = planBasemap(points, width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#d5dee6';
  ctx.fillRect(0, 0, width, height);

  const images = await Promise.all(
    plan.tiles.map(async (tile) => {
      try {
        return { tile, img: await fetchTile(tile) };
      } catch {
        return { tile, img: null };
      }
    })
  );
  let drawn = 0;
  for (const { tile, img } of images) {
    if (!img) continue;
    ctx.drawImage(img, tile.left, tile.top, 256, 256);
    drawn += 1;
  }
  if (!drawn) throw new Error('Карта без подложки');

  for (const marker of plan.markers) drawMarker(ctx, marker);
  drawAttribution(ctx, width, height);
  return canvas.toDataURL('image/png');
}
