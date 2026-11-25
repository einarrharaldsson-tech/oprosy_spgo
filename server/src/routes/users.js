import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { authRequired, isAdmin, requireRoles } from '../middleware/auth.js';
import { getMunicipalityById } from '../services/municipalities.js';
import { hashPassword } from '../services/authPassword.js';

const router = Router();
const ALL_ROLES = ['admin', 'editor', 'user'];
const EDITOR_CREATABLE_ROLES = ['editor', 'user'];

router.use(authRequired, requireRoles('admin', 'editor'));

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

const USER_SELECT = `
  SELECT u.id, u.login, u.full_name, u.role, u.is_active, u.created_at, u.municipality_id,
         m.name_full AS municipality_name_full, m.name_short AS municipality_name_short
  FROM users u
  LEFT JOIN municipalities m ON m.id = u.municipality_id
`;

async function resolveMunicipalityIdForRole(role, municipalityId, actor) {
  // Editors may only create/update inside their own municipality.
  if (actor.role === 'editor') {
    if (!actor.municipality_id) {
      const err = new Error('Учётная запись редактора не привязана к округу');
      err.status = 403;
      throw err;
    }
    if (municipalityId != null && municipalityId !== '' && Number(municipalityId) !== Number(actor.municipality_id)) {
      const err = new Error('Редактор может работать только с пользователями своего округа');
      err.status = 403;
      throw err;
    }
    return Number(actor.municipality_id);
  }

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

function assertEditorMayManageTarget(actor, target) {
  if (actor.role !== 'editor') return;
  if (!actor.municipality_id) {
    const err = new Error('Учётная запись редактора не привязана к округу');
    err.status = 403;
    throw err;
  }
  if (target.role === 'admin') {
    const err = new Error('Редактор не может управлять администраторами');
    err.status = 403;
    throw err;
  }
  if (Number(target.municipality_id) !== Number(actor.municipality_id)) {
    const err = new Error('Нет доступа к пользователям другого округа');
    err.status = 403;
    throw err;
  }
}

router.get('/', async (req, res) => {
  try {
    let users;
    if (isAdmin(req.user)) {
      users = await query(`${USER_SELECT} ORDER BY u.full_name, u.login`);
    } else {
      if (!req.user.municipality_id) {
        return res.status(403).json({ error: 'Учётная запись редактора не привязана к округу' });
      }
      users = await query(
        `${USER_SELECT}
         WHERE u.municipality_id = :municipalityId AND u.role IN ('editor', 'user')
         ORDER BY u.full_name, u.login`,
        { municipalityId: req.user.municipality_id }
      );
    }
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

    const allowedRoles = isAdmin(req.user) ? ALL_ROLES : EDITOR_CREATABLE_ROLES;
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({
        error: isAdmin(req.user)
          ? 'Некорректная роль'
          : 'Редактор может создавать только редакторов и пользователей',
      });
    }

    const existing = await query('SELECT id FROM users WHERE login = :login', {
      login: String(login).trim(),
    });
    if (existing.length) {
      return res.status(409).json({ error: 'Логин уже занят' });
    }

    const muniId = await resolveMunicipalityIdForRole(role, municipalityId, req.user);
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

    const created = await query(`${USER_SELECT} WHERE u.id = :id`, { id: result.insertId });
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
    const target = users[0];
    assertEditorMayManageTarget(req.user, target);

    if (role !== undefined) {
      const allowedRoles = isAdmin(req.user) ? ALL_ROLES : EDITOR_CREATABLE_ROLES;
      if (!allowedRoles.includes(role)) {
        return res.status(400).json({ error: 'Некорректная роль' });
      }
      if (!isAdmin(req.user) && role === 'admin') {
        return res.status(403).json({ error: 'Редактор не может назначать роль администратора' });
      }
    }

    if (id === req.user.id && role && role !== req.user.role && role !== 'admin' && isAdmin(req.user)) {
      // admin demoting self — keep existing guard
    }
    if (id === req.user.id && role && isAdmin(req.user) && role !== 'admin') {
      return res.status(400).json({ error: 'Нельзя снять с себя роль администратора' });
    }
    if (id === req.user.id && isActive === false) {
      return res.status(400).json({ error: 'Нельзя отключить собственную учётную запись' });
    }
    // Only admins may block/unblock accounts
    if (isActive !== undefined && !isAdmin(req.user)) {
      return res.status(403).json({ error: 'Блокировать пользователей может только администратор' });
    }

    const fields = [];
    const params = { id };
    const nextRole = role !== undefined ? role : target.role;

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
        municipalityId !== undefined ? municipalityId : target.municipality_id;
      const muniId = await resolveMunicipalityIdForRole(nextRole, rawMuni, req.user);
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

    const updated = await query(`${USER_SELECT} WHERE u.id = :id`, { id });
    res.json(mapUser(updated[0]));
  } catch (err) {
    console.error(err);
    if (err.status) return res.status(err.status).json({ error: err.message });
    res.status(500).json({ error: 'Не удалось обновить пользователя' });
  }
});

/**
 * Delete a user.
 * Admin: any non-self user (with last-admin guard).
 * Editor: only editor/user of the same municipality.
 * Responses / upload sessions / surveys created by them are reassigned to the current actor.
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

    const users = await query('SELECT id, login, role, municipality_id FROM users WHERE id = :id', {
      id,
    });
    if (!users.length) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    const target = users[0];
    assertEditorMayManageTarget(req.user, target);

    if (target.role === 'admin') {
      if (!isAdmin(req.user)) {
        return res.status(403).json({ error: 'Редактор не может удалять администраторов' });
      }
      const admins = await query(`SELECT COUNT(*) AS c FROM users WHERE role = 'admin'`);
      if (Number(admins[0].c) <= 1) {
        return res.status(400).json({ error: 'Нельзя удалить последнего администратора' });
      }
    }

    const actorId = req.user.id;
    const stats = await withTransaction(async (conn) => {
      const [resp] = await conn.execute(
        `UPDATE responses SET conducted_by = :actorId WHERE conducted_by = :id`,
        { actorId, id }
      );
      const [uploads] = await conn.execute(
        `UPDATE response_upload_sessions SET conducted_by = :actorId WHERE conducted_by = :id`,
        { actorId, id }
      );
      const [surveys] = await conn.execute(
        `UPDATE surveys SET created_by = :actorId WHERE created_by = :id`,
        { actorId, id }
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
      reassignedToAdminId: actorId,
      ...stats,
    });
  } catch (err) {
    console.error(err);
    if (err.status) return res.status(err.status).json({ error: err.message });
    res.status(500).json({ error: 'Не удалось удалить пользователя' });
  }
});

export default router;
