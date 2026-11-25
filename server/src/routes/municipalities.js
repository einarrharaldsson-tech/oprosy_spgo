import { Router } from 'express';
import { query } from '../db.js';
import { authRequired, requireRoles } from '../middleware/auth.js';
import { listMunicipalities, mapMunicipality } from '../services/municipalities.js';

const router = Router();

function normalizeInn(raw) {
  const inn = String(raw || '').replace(/\D/g, '');
  if (inn.length !== 10 && inn.length !== 12) {
    return null;
  }
  return inn;
}

/** Municipalities list — admin: all (or active); editor/user: only own. */
router.get('/', authRequired, async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      const activeOnly = !(req.query.all === '1' || req.query.all === 'true');
      return res.json(await listMunicipalities({ activeOnly }));
    }
    if (!req.user.municipality_id) {
      return res.json([]);
    }
    const rows = await query(
      `SELECT id, inn, name_full, name_short, is_active, created_at, updated_at
       FROM municipalities WHERE id = :id AND is_active = 1`,
      { id: req.user.municipality_id }
    );
    res.json(rows.map(mapMunicipality));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось загрузить округа' });
  }
});

router.use(authRequired, requireRoles('admin'));

router.post('/', async (req, res) => {
  try {
    const inn = normalizeInn(req.body?.inn);
    const nameFull = String(req.body?.nameFull || '').trim();
    const nameShort = String(req.body?.nameShort || '').trim();
    if (!inn) {
      return res.status(400).json({ error: 'ИНН: 10 или 12 цифр' });
    }
    if (!nameFull || !nameShort) {
      return res.status(400).json({ error: 'Укажите полное и краткое наименование' });
    }

    const dup = await query(
      `SELECT id FROM municipalities WHERE inn = :inn OR name_short = :nameShort LIMIT 1`,
      { inn, nameShort }
    );
    if (dup.length) {
      return res.status(409).json({ error: 'Округ с таким ИНН или кратким названием уже есть' });
    }

    const result = await query(
      `INSERT INTO municipalities (inn, name_full, name_short, is_active)
       VALUES (:inn, :nameFull, :nameShort, 1)`,
      { inn, nameFull, nameShort }
    );
    const rows = await query(
      `SELECT id, inn, name_full, name_short, is_active, created_at, updated_at
       FROM municipalities WHERE id = :id`,
      { id: result.insertId }
    );
    res.status(201).json(mapMunicipality(rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось создать округ' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await query(`SELECT id FROM municipalities WHERE id = :id`, { id });
    if (!existing.length) {
      return res.status(404).json({ error: 'Округ не найден' });
    }

    const fields = [];
    const params = { id };

    if (req.body?.inn !== undefined) {
      const inn = normalizeInn(req.body.inn);
      if (!inn) return res.status(400).json({ error: 'ИНН: 10 или 12 цифр' });
      fields.push('inn = :inn');
      params.inn = inn;
    }
    if (req.body?.nameFull !== undefined) {
      const nameFull = String(req.body.nameFull).trim();
      if (!nameFull) return res.status(400).json({ error: 'Укажите полное наименование' });
      fields.push('name_full = :nameFull');
      params.nameFull = nameFull;
    }
    if (req.body?.nameShort !== undefined) {
      const nameShort = String(req.body.nameShort).trim();
      if (!nameShort) return res.status(400).json({ error: 'Укажите краткое наименование' });
      fields.push('name_short = :nameShort');
      params.nameShort = nameShort;
    }
    if (req.body?.isActive !== undefined) {
      fields.push('is_active = :isActive');
      params.isActive = req.body.isActive ? 1 : 0;
    }

    if (!fields.length) {
      return res.status(400).json({ error: 'Нет данных для обновления' });
    }

    try {
      await query(`UPDATE municipalities SET ${fields.join(', ')} WHERE id = :id`, params);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'Округ с таким ИНН или кратким названием уже есть' });
      }
      throw err;
    }

    const rows = await query(
      `SELECT id, inn, name_full, name_short, is_active, created_at, updated_at
       FROM municipalities WHERE id = :id`,
      { id }
    );
    res.json(mapMunicipality(rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось обновить округ' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await query(`SELECT id FROM municipalities WHERE id = :id`, { id });
    if (!existing.length) {
      return res.status(404).json({ error: 'Округ не найден' });
    }

    const [users] = await query(
      `SELECT COUNT(*) AS c FROM users WHERE municipality_id = :id`,
      { id }
    );
    const [surveys] = await query(
      `SELECT COUNT(*) AS c FROM surveys WHERE municipality_id = :id`,
      { id }
    );
    if (Number(users.c) > 0 || Number(surveys.c) > 0) {
      return res.status(400).json({
        error:
          'Нельзя удалить округ с пользователями или опросами. Отключите его или перенесите данные.',
        users: Number(users.c) || 0,
        surveys: Number(surveys.c) || 0,
      });
    }

    await query(`DELETE FROM municipalities WHERE id = :id`, { id });
    res.json({ ok: true, deletedId: id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось удалить округ' });
  }
});

export default router;
