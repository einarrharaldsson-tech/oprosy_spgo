import { Router } from 'express';
import { authRequired, requireRoles } from '../middleware/auth.js';

const router = Router();
const USER_AGENT = 'OprosySPGO/1.2.18 (survey analytics PDF map)';
const cache = new Map();
const MAX_CACHE = 200;

function parseCoord(value, max) {
  if (!/^\d+$/.test(String(value))) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > max) return null;
  return n;
}

function remember(key, buf) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, buf);
  while (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

router.use(authRequired, requireRoles('admin', 'editor'));

router.get('/:z/:x/:y', async (req, res) => {
  const z = parseCoord(req.params.z, 19);
  if (z == null) return res.status(400).json({ error: 'Некорректный масштаб' });
  const max = 2 ** z - 1;
  const x = parseCoord(req.params.x, max);
  const y = parseCoord(req.params.y, max);
  if (x == null || y == null) return res.status(400).json({ error: 'Некорректный тайл' });

  const key = `${z}/${x}/${y}`;
  const hit = cache.get(key);
  if (hit) {
    remember(key, hit);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    return res.send(hit);
  }

  try {
    const upstream = await fetch(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'image/png' },
      signal: AbortSignal.timeout(8000),
    });
    if (!upstream.ok) return res.status(502).json({ error: 'Тайл карты недоступен' });
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length < 8 || buf[0] !== 0x89 || buf[1] !== 0x50) {
      return res.status(502).json({ error: 'Тайл карты недоступен' });
    }
    remember(key, buf);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    return res.send(buf);
  } catch {
    return res.status(502).json({ error: 'Тайл карты недоступен' });
  }
});

export default router;
