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
      `SELECT u.id, u.login, u.full_name, u.role, u.municipality_id, u.is_active,
              m.inn AS municipality_inn,
              m.name_full AS municipality_name_full,
              m.name_short AS municipality_name_short,
              m.is_active AS municipality_is_active
       FROM users u
       LEFT JOIN municipalities m ON m.id = u.municipality_id
       WHERE u.id = :id`,
      { id: payload.id }
    );
    if (!users.length) {
      return res.status(401).json({ error: 'Пользователь не найден' });
    }
    if (!users[0].is_active) {
      return res.status(403).json({ error: 'Учетная запись заблокирована' });
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

/** Public user shape for login /me responses. */
export function publicUser(user) {
  if (!user) return null;
  const municipality =
    user.municipality_id && user.municipality_name_full
      ? {
          id: user.municipality_id,
          inn: user.municipality_inn || '',
          nameFull: user.municipality_name_full,
          nameShort: user.municipality_name_short || '',
          isActive: user.municipality_is_active == null ? true : !!user.municipality_is_active,
        }
      : user.municipality_id
        ? { id: user.municipality_id, inn: '', nameFull: '', nameShort: '', isActive: true }
        : null;
  return {
    id: user.id,
    login: user.login,
    fullName: user.full_name,
    role: user.role,
    municipalityId: user.municipality_id || null,
    municipality,
  };
}
