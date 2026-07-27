import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db.js';

export function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, login: user.login },
    config.jwtSecret,
    { expiresIn: '12h' }
  );
}

export async function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const users = await query(
      'SELECT id, login, full_name, role, is_active FROM users WHERE id = :id',
      { id: payload.id }
    );
    if (!users.length || !users[0].is_active) {
      return res.status(401).json({ error: 'Пользователь не найден или отключён' });
    }
    req.user = users[0];
    next();
  } catch {
    return res.status(401).json({ error: 'Недействительный токен' });
  }
}

export function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }
    next();
  };
}

export function canManageSurveys(user) {
  return user.role === 'admin' || user.role === 'editor';
}

export function isAdmin(user) {
  return user.role === 'admin';
}
