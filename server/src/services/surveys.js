import { query } from '../db.js';
import { isScopedToMunicipality, surveyMunicipalityClause } from './municipalities.js';

export async function loadSurveyStructure(surveyId) {
  const surveys = await query(
    `SELECT s.id, s.title, s.description, s.conduct_mode, s.status, s.created_by, s.municipality_id,
            s.created_at, s.updated_at, s.archived_at, s.completed_at,
            u.full_name AS creator_name, u.login AS creator_login,
            m.inn AS municipality_inn,
            m.name_full AS municipality_name_full,
            m.name_short AS municipality_name_short
     FROM surveys s
     JOIN users u ON u.id = s.created_by
     LEFT JOIN municipalities m ON m.id = s.municipality_id
     WHERE s.id = :id`,
    { id: surveyId }
  );
  if (!surveys.length) return null;

  const questions = await query(
    `SELECT id, survey_id, text, answer_type, is_required, allow_multiple, sort_order
     FROM questions WHERE survey_id = :id ORDER BY sort_order, id`,
    { id: surveyId }
  );

  const options = questions.length
    ? await query(
        `SELECT id, question_id, text, jump_action, jump_target_question_id, sort_order
         FROM options
         WHERE question_id IN (${questions.map((q) => q.id).join(',')})
         ORDER BY sort_order, id`
      )
    : [];

  const access = await query(
    `SELECT user_id FROM survey_access WHERE survey_id = :id`,
    { id: surveyId }
  );

  const [countRows] = await query(
    `SELECT COUNT(*) AS cnt FROM responses WHERE survey_id = :id`,
    { id: surveyId }
  );

  const optionsByQuestion = new Map();
  const questionIndexById = new Map(questions.map((q, index) => [Number(q.id), index]));
  for (const opt of options) {
    if (!optionsByQuestion.has(opt.question_id)) {
      optionsByQuestion.set(opt.question_id, []);
    }
    const targetId =
      opt.jump_target_question_id != null ? Number(opt.jump_target_question_id) : null;
    optionsByQuestion.get(opt.question_id).push({
      id: opt.id,
      text: opt.text,
      jumpAction: opt.jump_action || 'none',
      jumpTargetQuestionId: targetId,
      jumpToQuestionIndex:
        targetId != null && questionIndexById.has(targetId)
          ? questionIndexById.get(targetId)
          : null,
      sortOrder: opt.sort_order,
    });
  }

  const survey = surveys[0];
  return {
    id: survey.id,
    title: survey.title,
    description: survey.description,
    conductMode: survey.conduct_mode === 'step' ? 'step' : 'scroll',
    status: survey.status,
    createdBy: survey.created_by,
    municipalityId: survey.municipality_id || null,
    municipality: survey.municipality_id
      ? {
          id: survey.municipality_id,
          inn: survey.municipality_inn || '',
          nameFull: survey.municipality_name_full || '',
          nameShort: survey.municipality_name_short || '',
        }
      : null,
    createdAt: survey.created_at,
    updatedAt: survey.updated_at,
    archivedAt: survey.archived_at,
    completedAt: survey.completed_at,
    creatorName: survey.creator_name || survey.creator_login,
    responseCount: Number(countRows.cnt) || 0,
    accessUserIds: access.map((a) => a.user_id),
    questions: questions.map((q) => ({
      id: q.id,
      text: q.text,
      answerType: q.answer_type,
      isRequired: !!q.is_required,
      allowMultiple: q.answer_type === 'checkbox' ? q.allow_multiple !== 0 : false,
      sortOrder: q.sort_order,
      options: optionsByQuestion.get(q.id) || [],
    })),
  };
}

function municipalityForbidden(user, surveyRow) {
  if (!isScopedToMunicipality(user)) return false;
  if (!user.municipality_id) return true;
  return Number(surveyRow.municipality_id) !== Number(user.municipality_id);
}

export async function userCanConduct(user, surveyId) {
  if (user.role === 'admin' || user.role === 'editor') {
    const rows = await query(
      `SELECT id, status, municipality_id FROM surveys WHERE id = :id`,
      { id: surveyId }
    );
    if (!rows.length) return { ok: false, reason: 'not_found' };
    if (municipalityForbidden(user, rows[0])) return { ok: false, reason: 'forbidden' };
    const { status } = rows[0];
    if (status === 'draft') return { ok: false, reason: 'draft' };
    if (status === 'completed') return { ok: false, reason: 'completed' };
    if (status === 'archived') return { ok: false, reason: 'archived' };
    return { ok: true, survey: rows[0] };
  }

  const scope = surveyMunicipalityClause(user, 's');
  const rows = await query(
    `SELECT s.id, s.status, s.municipality_id
     FROM surveys s
     JOIN survey_access sa ON sa.survey_id = s.id AND sa.user_id = :userId
     WHERE s.id = :id AND s.status = 'active'${scope.sql}`,
    { id: surveyId, userId: user.id, ...scope.params }
  );
  if (!rows.length) return { ok: false, reason: 'forbidden' };
  return { ok: true, survey: rows[0] };
}

export async function userCanEditSurvey(user, surveyId) {
  if (user.role !== 'admin' && user.role !== 'editor') {
    return { ok: false, reason: 'forbidden' };
  }
  const rows = await query(
    `SELECT id, status, created_by, municipality_id FROM surveys WHERE id = :id`,
    { id: surveyId }
  );
  if (!rows.length) return { ok: false, reason: 'not_found' };
  if (municipalityForbidden(user, rows[0])) return { ok: false, reason: 'forbidden' };
  if (user.role === 'editor' && rows[0].status === 'archived') {
    return { ok: false, reason: 'archived' };
  }
  return { ok: true, survey: rows[0] };
}

export async function userCanViewSurveyResults(user, surveyId) {
  if (user.role === 'admin') {
    const rows = await query(
      `SELECT id, status, municipality_id FROM surveys WHERE id = :id`,
      { id: surveyId }
    );
    if (!rows.length) return { ok: false, reason: 'not_found' };
    return { ok: true, survey: rows[0] };
  }
  if (user.role === 'editor') {
    const rows = await query(
      `SELECT id, status, municipality_id FROM surveys WHERE id = :id`,
      { id: surveyId }
    );
    if (!rows.length) return { ok: false, reason: 'not_found' };
    if (municipalityForbidden(user, rows[0])) return { ok: false, reason: 'forbidden' };
    if (rows[0].status === 'archived') return { ok: false, reason: 'archived' };
    return { ok: true, survey: rows[0] };
  }
  return { ok: false, reason: 'forbidden' };
}

/** Ensure survey is visible to this user (municipality + role rules). */
export function userCanAccessSurveyRecord(user, survey) {
  if (!survey) return false;
  if (user.role === 'admin') return true;
  if (municipalityForbidden(user, { municipality_id: survey.municipalityId })) return false;
  if (user.role === 'editor') {
    return survey.status !== 'archived';
  }
  if (user.role === 'user') {
    return survey.status === 'active' && (survey.accessUserIds || []).includes(user.id);
  }
  return false;
}
