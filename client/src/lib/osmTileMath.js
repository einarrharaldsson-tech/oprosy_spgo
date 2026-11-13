const TILE = 256;

export function project(lat, lng, zoom) {
  const sin = Math.sin((lat * Math.PI) / 180);
  const clamped = Math.min(Math.max(sin, -0.9999), 0.9999);
  const scale = TILE * 2 ** zoom;
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + clamped) / (1 - clamped)) / (4 * Math.PI)) * scale,
  };
}

/**
 * Fit every point into a pixel viewport and list the OpenStreetMap tiles
 * that cover it. Coordinates are in the same pixel space as `width`/`height`.
 */
export function planBasemap(points, width, height) {
  const pad = Math.round(Math.min(width, height) * 0.14);
  let zoom = 17;
  let minX = 0;
  let maxX = 0;
  let minY = 0;
  let maxY = 0;

  for (; zoom >= 3; zoom -= 1) {
    const projected = points.map((p) => project(p.lat, p.lng, zoom));
    minX = Math.min(...projected.map((p) => p.x));
    maxX = Math.max(...projected.map((p) => p.x));
    minY = Math.min(...projected.map((p) => p.y));
    maxY = Math.max(...projected.map((p) => p.y));
    const fits = maxX - minX <= width - pad * 2 && maxY - minY <= height - pad * 2;
    if (fits || zoom === 3) break;
  }

  const world = TILE * 2 ** zoom;
  let originX = (minX + maxX) / 2 - width / 2;
  let originY = (minY + maxY) / 2 - height / 2;
  if (width < world) originX = Math.max(0, Math.min(originX, world - width));
  if (height < world) originY = Math.max(0, Math.min(originY, world - height));

  const x0 = Math.floor(originX / TILE);
  const x1 = Math.floor((originX + width - 1) / TILE);
  const y0 = Math.floor(originY / TILE);
  const y1 = Math.floor((originY + height - 1) / TILE);
  const n = 2 ** zoom;
  const tiles = [];
  for (let x = x0; x <= x1; x += 1) {
    for (let y = y0; y <= y1; y += 1) {
      if (y < 0 || y >= n) continue;
      const wrappedX = ((x % n) + n) % n;
      tiles.push({
        z: zoom,
        x: wrappedX,
        y,
        left: x * TILE - originX,
        top: y * TILE - originY,
      });
    }
  }

  const markers = points.map((p) => {
    const pt = project(p.lat, p.lng, zoom);
    return {
      x: pt.x - originX,
      y: pt.y - originY,
      n: p.n ?? p.sessionNumber,
    };
  });

  return { zoom, width, height, tiles, markers };
}
