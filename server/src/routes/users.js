import { Router } from 'express';
import { query } from '../db.js';
import { authRequired, requireRoles } from '../middleware/auth.js';
import { hashPassword } from '../services/authPassword.js';

const router = Router();
const ROLES = ['admin', 'editor', 'user'];

router.use(authRequired, requireRoles('admin'));

router.get('/', async (_req, res) => {
  try {
    const users = await query(
      `SELECT id, login, full_name, role, is_active, created_at
       FROM users
       ORDER BY full_name, login`
    );
    res.json(
      users.map((u) => ({
        id: u.id,
        login: u.login,
        fullName: u.full_name,
        role: u.role,
        isActive: !!u.is_active,
        createdAt: u.created_at,
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось загрузить пользователей' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { login, password, fullName, role } = req.body || {};
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

    const passwordHash = await hashPassword(String(password));
    const result = await query(
      `INSERT INTO users (login, password_hash, full_name, role)
       VALUES (:login, :passwordHash, :fullName, :role)`,
      {
        login: String(login).trim(),
        passwordHash,
        fullName: String(fullName || '').trim(),
        role,
      }
    );

    res.status(201).json({
      id: result.insertId,
      login: String(login).trim(),
      fullName: String(fullName || '').trim(),
      role,
      isActive: true,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось создать пользователя' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { fullName, role, isActive, password } = req.body || {};

    const users = await query('SELECT id, role FROM users WHERE id = :id', { id });
    if (!users.length) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    if (role !== undefined && !ROLES.includes(role)) {
      return res.status(400).json({ error: 'Некорректная роль' });
    }

    // Prevent locking yourself out of admin
    if (id === req.user.id && role && role !== 'admin') {
      return res.status(400).json({ error: 'Нельзя снять с себя роль администратора' });
    }
    if (id === req.user.id && isActive === false) {
      return res.status(400).json({ error: 'Нельзя отключить собственную учётную запись' });
    }

    const fields = [];
    const params = { id };

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
      'SELECT id, login, full_name, role, is_active, created_at FROM users WHERE id = :id',
      { id }
    );
    const u = updated[0];
    res.json({
      id: u.id,
      login: u.login,
      fullName: u.full_name,
      role: u.role,
      isActive: !!u.is_active,
      createdAt: u.created_at,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось обновить пользователя' });
  }
});

export default router;
