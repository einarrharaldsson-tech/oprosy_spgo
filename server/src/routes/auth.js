import { Router } from 'express';
import { query } from '../db.js';
import { verifyPassword } from '../services/authPassword.js';
import { authRequired, signToken } from '../middleware/auth.js';

const router = Router();

router.post('/login', async (req, res) => {
  try {
    const { login, password } = req.body || {};
    if (!login || !password) {
      return res.status(400).json({ error: 'Укажите логин и пароль' });
    }

    const users = await query(
      'SELECT id, login, password_hash, full_name, role, is_active FROM users WHERE login = :login',
      { login: String(login).trim() }
    );

    if (!users.length || !users[0].is_active) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    const user = users[0];
    const ok = await verifyPassword(String(password), user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    const token = signToken(user);
    res.json({
      token,
      user: {
        id: user.id,
        login: user.login,
        fullName: user.full_name,
        role: user.role,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка входа' });
  }
});

router.get('/me', authRequired, (req, res) => {
  res.json({
    id: req.user.id,
    login: req.user.login,
    fullName: req.user.full_name,
    role: req.user.role,
  });
});

export default router;
