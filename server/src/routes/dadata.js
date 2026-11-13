import { Router } from 'express';
import { config } from '../config.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();
const DADATA_URL = 'https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/address';
const GEOLOCATE_URL = 'https://suggestions.dadata.ru/suggestions/api/4_1/rs/geolocate/address';

function mapSuggestion(s) {
  const lat = s.data?.geo_lat != null ? Number(s.data.geo_lat) : null;
  const lng = s.data?.geo_lon != null ? Number(s.data.geo_lon) : null;
  return {
    value: s.value,
    unrestrictedValue: s.unrestricted_value,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
  };
}

async function dadataPost(url, body) {
  const upstream = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Token ${config.dadataApiKey}`,
    },
    body: JSON.stringify(body),
  });
  const text = await upstream.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { upstream, data, text };
}

router.use(authRequired);

/** Proxy to DaData address suggestions (API key stays on server) */
router.post('/address', async (req, res) => {
  try {
    if (!config.dadataApiKey) {
      return res.status(503).json({ error: 'Подсказки адресов не настроены (нет DADATA_API_KEY)' });
    }

    const query = String(req.body?.query || '').trim();
    if (query.length < 2) {
      return res.json({ suggestions: [] });
    }

    const count = Math.min(Math.max(Number(req.body?.count) || 7, 1), 20);

    const { upstream, data, text } = await dadataPost(DADATA_URL, { query, count });

    if (!upstream.ok) {
      console.error('DaData error', upstream.status, text?.slice(0, 300));
      const msg =
        upstream.status === 403
          ? 'DaData: доступ запрещён (ключ, лимит или почта не подтверждена)'
          : upstream.status === 401
            ? 'DaData: неверный API-ключ'
            : 'Не удалось получить подсказки адреса';
      return res.status(502).json({ error: msg });
    }

    const suggestions = (data?.suggestions || []).map(mapSuggestion);

    res.json({ suggestions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка подсказок адреса' });
  }
});

/** Reverse geocode: coordinates → address (DaData geolocate) */
router.post('/geolocate', async (req, res) => {
  try {
    if (!config.dadataApiKey) {
      return res.status(503).json({ error: 'Подсказки адресов не настроены (нет DADATA_API_KEY)' });
    }

    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng ?? req.body?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'Некорректные координаты' });
    }

    const { upstream, data, text } = await dadataPost(GEOLOCATE_URL, { lat, lon: lng });

    if (!upstream.ok) {
      console.error('DaData geolocate error', upstream.status, text?.slice(0, 300));
      return res.status(502).json({ error: 'Не удалось определить адрес по координатам' });
    }

    const first = (data?.suggestions || [])[0];
    if (!first) {
      return res.json({ value: null, lat, lng });
    }

    const mapped = mapSuggestion(first);
    res.json({
      value: mapped.value,
      unrestrictedValue: mapped.unrestrictedValue,
      lat: mapped.lat ?? lat,
      lng: mapped.lng ?? lng,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка геокодирования' });
  }
});

export default router;
