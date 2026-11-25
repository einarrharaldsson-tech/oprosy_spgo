import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { authRequired, requireRoles } from '../middleware/auth.js';
import { getMunicipalityById } from '../services/municipalities.js';
import { hashPassword } from '../services/authPassword.js';

const router = Router();
const ROLES = ['admin', 'editor', 'user'];

router.use(authRequired, requireRoles('admin'));

function mapUser(u) {
  return {
    id: u.id,
    login: u.login,
    fullName: u.full_name,
    role: u.role,
    isActive: !!u.is_active,
    createdAt: u.created_at,
    municipalityId: u.municipality_id || null,
    municipalityNameFull: u.municipality_name_full || null,
    municipalityNameShort: u.municipality_name_short || null,
  };
}

async function resolveMunicipalityIdForRole(role, municipalityId) {
  if (role === 'admin') {
    if (municipalityId == null || municipalityId === '') return null;
    const m = await getMunicipalityById(Number(municipalityId));
    if (!m) {
      const err = new Error('Округ не найден');
      err.status = 400;
      throw err;
    }
    return m.id;
  }
  if (municipalityId == null || municipalityId === '') {
    const err = new Error('Для редактора и пользователя укажите округ');
    err.status = 400;
    throw err;
  }
  const m = await getMunicipalityById(Number(municipalityId));
  if (!m || !m.isActive) {
    const err = new Error('Округ не найден или отключён');
    err.status = 400;
    throw err;
  }
  return m.id;
}

router.get('/', async (_req, res) => {
  try {
    const users = await query(
      `SELECT u.id, u.login, u.full_name, u.role, u.is_active, u.created_at, u.municipality_id,
              m.name_full AS municipality_name_full, m.name_short AS municipality_name_short
       FROM users u
       LEFT JOIN municipalities m ON m.id = u.municipality_id
       ORDER BY u.full_name, u.login`
    );
    res.json(users.map(mapUser));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось загрузить пользователей' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { login, password, fullName, role, municipalityId } = req.body || {};
    if (!login || !password) {
      return res.status(400).json({ error: 'Логин и пароль обязательны' });
    }
    if (String(password).length < 4) {
      return res.status(400).json({ error: 'Пароль не короче 4 символов' });
    }
    if (!ROLES.includes(role)) {
      return res.status(400).json({ error: 'Некорректная роль' });
    }

    const existing = await query('SELECT id FROM users WHERE login = :login', {
      login: String(login).trim(),
    });
    if (existing.length) {
      return res.status(409).json({ error: 'Логин уже занят' });
    }

    const muniId = await resolveMunicipalityIdForRole(role, municipalityId);
    const passwordHash = await hashPassword(String(password));
    const result = await query(
      `INSERT INTO users (login, password_hash, full_name, role, municipality_id)
       VALUES (:login, :passwordHash, :fullName, :role, :municipalityId)`,
      {
        login: String(login).trim(),
        passwordHash,
        fullName: String(fullName || '').trim(),
        role,
        municipalityId: muniId,
      }
    );

    const created = await query(
      `SELECT u.id, u.login, u.full_name, u.role, u.is_active, u.created_at, u.municipality_id,
              m.name_full AS municipality_name_full, m.name_short AS municipality_name_short
       FROM users u
       LEFT JOIN municipalities m ON m.id = u.municipality_id
       WHERE u.id = :id`,
      { id: result.insertId }
    );
    res.status(201).json(mapUser(created[0]));
  } catch (err) {
    console.error(err);
    if (err.status) return res.status(err.status).json({ error: err.message });
    res.status(500).json({ error: 'Не удалось создать пользователя' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { fullName, role, isActive, password, municipalityId } = req.body || {};

    const users = await query('SELECT id, role, municipality_id FROM users WHERE id = :id', { id });
    if (!users.length) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    if (role !== undefined && !ROLES.includes(role)) {
      return res.status(400).json({ error: 'Некорректная роль' });
    }

    if (id === req.user.id && role && role !== 'admin') {
      return res.status(400).json({ error: 'Нельзя снять с себя роль администратора' });
    }
    if (id === req.user.id && isActive === false) {
      return res.status(400).json({ error: 'Нельзя отключить собственную учётную запись' });
    }

    const fields = [];
    const params = { id };
    const nextRole = role !== undefined ? role : users[0].role;

    if (fullName !== undefined) {
      fields.push('full_name = :fullName');
      params.fullName = String(fullName).trim();
    }
    if (role !== undefined) {
      fields.push('role = :role');
      params.role = role;
    }
    if (isActive !== undefined) {
      fields.push('is_active = :isActive');
      params.isActive = isActive ? 1 : 0;
    }
    if (municipalityId !== undefined || role !== undefined) {
      const rawMuni =
        municipalityId !== undefined ? municipalityId : users[0].municipality_id;
      const muniId = await resolveMunicipalityIdForRole(nextRole, rawMuni);
      fields.push('municipality_id = :municipalityId');
      params.municipalityId = muniId;
    }
    if (password) {
      if (String(password).length < 4) {
        return res.status(400).json({ error: 'Пароль не короче 4 символов' });
      }
      fields.push('password_hash = :passwordHash');
      params.passwordHash = await hashPassword(String(password));
    }

    if (!fields.length) {
      return res.status(400).json({ error: 'Нет данных для обновления' });
    }

    await query(`UPDATE users SET ${fields.join(', ')} WHERE id = :id`, params);

    const updated = await query(
      `SELECT u.id, u.login, u.full_name, u.role, u.is_active, u.created_at, u.municipality_id,
              m.name_full AS municipality_name_full, m.name_short AS municipality_name_short
       FROM users u
       LEFT JOIN municipalities m ON m.id = u.municipality_id
       WHERE u.id = :id`,
      { id }
    );
    res.json(mapUser(updated[0]));
  } catch (err) {
    console.error(err);
    if (err.status) return res.status(err.status).json({ error: err.message });
    res.status(500).json({ error: 'Не удалось обновить пользователя' });
  }
});

/**
 * Delete a user (admin only).
 * Responses / upload sessions / surveys created by them are reassigned to the current admin
 * so historical conducts stay visible as «Администратор».
 */
router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Некорректный пользователь' });
    }
    if (id === req.user.id) {
      return res.status(400).json({ error: 'Нельзя удалить собственную учётную запись' });
    }

    const users = await query('SELECT id, login, role FROM users WHERE id = :id', { id });
    if (!users.length) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    const target = users[0];

    if (target.role === 'admin') {
      const admins = await query(`SELECT COUNT(*) AS c FROM users WHERE role = 'admin'`);
      if (Number(admins[0].c) <= 1) {
        return res.status(400).json({ error: 'Нельзя удалить последнего администратора' });
      }
    }

    const adminId = req.user.id;
    const stats = await withTransaction(async (conn) => {
      const [resp] = await conn.execute(
        `UPDATE responses SET conducted_by = :adminId WHERE conducted_by = :id`,
        { adminId, id }
      );
      const [uploads] = await conn.execute(
        `UPDATE response_upload_sessions SET conducted_by = :adminId WHERE conducted_by = :id`,
        { adminId, id }
      );
      const [surveys] = await conn.execute(
        `UPDATE surveys SET created_by = :adminId WHERE created_by = :id`,
        { adminId, id }
      );
      await conn.execute(`DELETE FROM users WHERE id = :id`, { id });
      return {
        responsesReassigned: resp.affectedRows || 0,
        uploadSessionsReassigned: uploads.affectedRows || 0,
        surveysReassigned: surveys.affectedRows || 0,
      };
    });

    res.json({
      ok: true,
      deletedId: id,
      deletedLogin: target.login,
      reassignedToAdminId: adminId,
      ...stats,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось удалить пользователя' });
  }
});

export default router;
