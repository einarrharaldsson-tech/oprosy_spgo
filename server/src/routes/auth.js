import { Router } from 'express';
import { query } from '../db.js';
import { verifyPassword } from '../services/authPassword.js';
import { authRequired, publicUser, signToken } from '../middleware/auth.js';

const router = Router();

router.post('/login', async (req, res) => {
  try {
    const { login, password } = req.body || {};
    if (!login || !password) {
      return res.status(400).json({ error: 'Укажите логин и пароль' });
    }

    const users = await query(
      `SELECT u.id, u.login, u.password_hash, u.full_name, u.role, u.municipality_id, u.is_active,
              m.inn AS municipality_inn,
              m.name_full AS municipality_name_full,
              m.name_short AS municipality_name_short,
              m.is_active AS municipality_is_active
       FROM users u
       LEFT JOIN municipalities m ON m.id = u.municipality_id
       WHERE u.login = :login`,
      { login: String(login).trim() }
    );

    if (!users.length) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    const user = users[0];
    const ok = await verifyPassword(String(password), user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'Учетная запись заблокирована' });
    }

    const token = signToken(user);
    res.json({
      token,
      user: publicUser(user),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка входа' });
  }
});

router.get('/me', authRequired, (req, res) => {
  res.json(publicUser(req.user));
});

export default router;
