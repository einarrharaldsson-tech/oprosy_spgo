import { Router } from 'express';
import { config } from '../config.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();
const DADATA_URL = 'https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/address';

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

    const upstream = await fetch(DADATA_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Token ${config.dadataApiKey}`,
      },
      body: JSON.stringify({ query, count }),
    });

    const text = await upstream.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

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

    const suggestions = (data?.suggestions || []).map((s) => ({
      value: s.value,
      unrestrictedValue: s.unrestricted_value,
    }));

    res.json({ suggestions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка подсказок адреса' });
  }
});

export default router;
