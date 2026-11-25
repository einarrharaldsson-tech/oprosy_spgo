import { query } from '../db.js';

export function mapMunicipality(row) {
  if (!row) return null;
  return {
    id: row.id,
    inn: row.inn,
    nameFull: row.name_full,
    nameShort: row.name_short,
    isActive: row.is_active == null ? true : !!row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getMunicipalityById(id) {
  if (!id) return null;
  const rows = await query(
    `SELECT id, inn, name_full, name_short, is_active, created_at, updated_at
     FROM municipalities WHERE id = :id`,
    { id: Number(id) }
  );
  return rows.length ? mapMunicipality(rows[0]) : null;
}

export async function listMunicipalities({ activeOnly = false } = {}) {
  const rows = await query(
    `SELECT id, inn, name_full, name_short, is_active, created_at, updated_at
     FROM municipalities
     ${activeOnly ? 'WHERE is_active = 1' : ''}
     ORDER BY name_full`
  );
  return rows.map(mapMunicipality);
}

/** Admins see everything; editors/users are scoped to their municipality. */
export function isScopedToMunicipality(user) {
  return user?.role === 'editor' || user?.role === 'user';
}

export function assertUserHasMunicipality(user) {
  if (isScopedToMunicipality(user) && !user.municipality_id) {
    const err = new Error('Учётная запись не привязана к округу');
    err.status = 403;
    throw err;
  }
}

/**
 * Resolve municipality_id for a newly created survey.
 * Editors always use their own; admins may pass municipalityId or fall back to their own.
 */
export async function resolveSurveyMunicipalityId(user, requestedId) {
  if (user.role === 'editor' || user.role === 'user') {
    if (!user.municipality_id) {
      const err = new Error('Учётная запись не привязана к округу');
      err.status = 403;
      throw err;
    }
    return Number(user.municipality_id);
  }

  if (requestedId != null && requestedId !== '') {
    const id = Number(requestedId);
    const m = await getMunicipalityById(id);
    if (!m || !m.isActive) {
      const err = new Error('Округ не найден или отключён');
      err.status = 400;
      throw err;
    }
    return id;
  }

  if (user.municipality_id) return Number(user.municipality_id);

  const err = new Error('Укажите округ для опроса');
  err.status = 400;
  throw err;
}

/** SQL fragment: restrict surveys (alias) to the user's municipality when scoped. */
export function surveyMunicipalityClause(user, alias = 's') {
  if (!isScopedToMunicipality(user)) {
    return { sql: '', params: {} };
  }
  return {
    sql: ` AND ${alias}.municipality_id = :scopeMunicipalityId `,
    params: { scopeMunicipalityId: Number(user.municipality_id) },
  };
}

export async function userBelongsToMunicipality(userId, municipalityId) {
  const rows = await query(
    `SELECT id FROM users
     WHERE id = :userId AND municipality_id = :municipalityId AND is_active = 1`,
    { userId: Number(userId), municipalityId: Number(municipalityId) }
  );
  return rows.length > 0;
}
