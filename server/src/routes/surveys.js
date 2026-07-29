import { Router } from 'express';
import fs from 'fs';
import { query, withTransaction } from '../db.js';
import { authRequired, isAdmin, requireRoles } from '../middleware/auth.js';
import { uploadAudio, uploadDocx } from '../middleware/upload.js';
import {
  absoluteAudioPath,
  deleteSurveyAudioDir,
  isAllowedAudioMime,
  saveResponseAudio,
  saveUploadChunk,
} from '../services/audioStorage.js';
import { parseDocxSurvey } from '../services/docxImport.js';
import {
  loadSurveyStructure,
  userCanConduct,
  userCanEditSurvey,
  userCanViewSurveyResults,
} from '../services/surveys.js';
import { csvWithBom, safeFilename, toCsv } from '../services/csv.js';
import {
  validateJumpConfiguration,
} from '../services/jumpLogic.js';
import { formatOptionAnswer, isOtherOptionText } from '../services/optionHelpers.js';
import {
  createSurveyResponseRecord,
  failUploadSession,
  finalizeUploadSession,
  getOrCreateUploadSession,
  listUploadChunkIndexes,
  loadUploadSession,
  markUploadSessionProgress,
  upsertUploadChunk,
  validateResponsePayload,
} from '../services/responseUploads.js';

const router = Router();

router.use(authRequired);

function validateImportQuestions(questions) {
  if (!Array.isArray(questions) || !questions.length) {
    return 'Добавьте хотя бы один вопрос';
  }
  for (const q of questions) {
    if (!q.text || !String(q.text).trim()) {
      return 'У каждого вопроса должен быть текст';
    }
    if (!['checkbox', 'text', 'select', 'address'].includes(q.answerType)) {
      return 'Тип ответа: checkbox, select, text или address';
    }
    if (q.answerType === 'checkbox' || q.answerType === 'select') {
      const opts = q.options || [];
      if (!opts.length || opts.some((o) => !o.text || !String(o.text).trim())) {
        return `Для вопроса «${String(q.text).slice(0, 60)}» нужны варианты ответов`;
      }
    }
  }
  return validateJumpConfiguration(questions);
}

async function insertQuestionsAndOptions(conn, { surveyId, questions }) {
  const createdQuestionIds = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const [qResult] = await conn.execute(
      `INSERT INTO questions (survey_id, text, answer_type, is_required, allow_multiple, sort_order)
       VALUES (:surveyId, :text, :answerType, :isRequired, :allowMultiple, :sortOrder)`,
      {
        surveyId,
        text: String(q.text).trim(),
        answerType: q.answerType,
        isRequired: q.isRequired === false ? 0 : 1,
        allowMultiple:
          q.answerType === 'checkbox' ? (q.allowMultiple === false ? 0 : 1) : 1,
        sortOrder: i,
      }
    );
    createdQuestionIds.push(qResult.insertId);
  }

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const questionId = createdQuestionIds[i];
    if (q.answerType === 'checkbox' || q.answerType === 'select') {
      const opts = q.options || [];
      for (let j = 0; j < opts.length; j++) {
        const action = opts[j].jumpAction === 'jump' || opts[j].jumpAction === 'end' ? opts[j].jumpAction : 'none';
        const targetIndex =
          action === 'jump' && Number.isInteger(Number(opts[j].jumpToQuestionIndex))
            ? Number(opts[j].jumpToQuestionIndex)
            : null;
        await conn.execute(
          `INSERT INTO options (question_id, text, jump_action, jump_target_question_id, sort_order)
           VALUES (:questionId, :text, :jumpAction, :jumpTargetQuestionId, :sortOrder)`,
          {
            questionId,
            text: String(opts[j].text).trim(),
            jumpAction: action,
            jumpTargetQuestionId:
              action === 'jump' && targetIndex !== null ? createdQuestionIds[targetIndex] : null,
            sortOrder: j,
          }
        );
      }
    }
  }
}

async function insertSurveyWithQuestions(conn, { title, description, createdBy, questions }) {
  const [created] = await conn.execute(
    `INSERT INTO surveys (title, description, status, created_by)
     VALUES (:title, :description, 'draft', :createdBy)`,
    {
      title: String(title).trim(),
      description: description ? String(description).trim() : null,
      createdBy,
    }
  );
  const surveyId = created.insertId;

  await insertQuestionsAndOptions(conn, { surveyId, questions });
  return surveyId;
}

/** Users list for access assignment (managers) — before /:id */
router.get('/meta/assignable-users', requireRoles('admin', 'editor'), async (_req, res) => {
  try {
    const users = await query(
      `SELECT id, login, full_name, role
       FROM users
       WHERE is_active = 1 AND role = 'user'
       ORDER BY full_name, login`
    );
    res.json(
      users.map((u) => ({
        id: u.id,
        login: u.login,
        fullName: u.full_name,
        role: u.role,
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось загрузить список' });
  }
});

/** Parse .docx into draft preview (admin) — no DB write */
router.post(
  '/import/parse',
  requireRoles('admin'),
  uploadDocx.single('file'),
  async (req, res) => {
    try {
      if (!req.file?.buffer?.length) {
        return res.status(400).json({ error: 'Загрузите файл .docx' });
      }
      const parsed = await parseDocxSurvey(req.file.buffer);
      if (!parsed.questions.length) {
        return res.status(400).json({
          error: 'Не удалось распознать вопросы в документе',
          warnings: parsed.warnings,
        });
      }
      res.json(parsed);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message || 'Не удалось разобрать документ' });
    }
  }
);

/** Create draft survey from edited import preview (admin) */
router.post('/import/commit', requireRoles('admin'), async (req, res) => {
  try {
    const { title, description, questions = [] } = req.body || {};
    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: 'Укажите название опроса' });
    }
    const errMsg = validateImportQuestions(questions);
    if (errMsg) {
      return res.status(400).json({ error: errMsg });
    }

    const surveyId = await withTransaction(async (conn) =>
      insertSurveyWithQuestions(conn, {
        title,
        description,
        createdBy: req.user.id,
        questions,
      })
    );

    const survey = await loadSurveyStructure(surveyId);
    res.status(201).json(survey);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось создать опрос из импорта' });
  }
});

/** List surveys for main UI / completed / history */
router.get('/', async (req, res) => {
  try {
    const archived = req.query.archived === '1' || req.query.archived === 'true';
    const completed = req.query.completed === '1' || req.query.completed === 'true';
    const { user } = req;

    if (archived) {
      if (!isAdmin(user)) {
        return res.status(403).json({ error: 'История доступна только администраторам' });
      }
      const rows = await query(
        `SELECT s.id, s.title, s.description, s.status, s.created_at, s.archived_at, s.completed_at,
                u.full_name AS creator_name,
                (SELECT COUNT(*) FROM responses r WHERE r.survey_id = s.id) AS response_count
         FROM surveys s
         JOIN users u ON u.id = s.created_by
         WHERE s.status = 'archived'
         ORDER BY s.archived_at DESC, s.id DESC`
      );
      return res.json(rows.map(mapListItem));
    }

    if (completed) {
      if (user.role !== 'admin' && user.role !== 'editor') {
        return res.status(403).json({ error: 'Завершённые доступны администраторам и редакторам' });
      }
      const rows = await query(
        `SELECT s.id, s.title, s.description, s.status, s.created_at, s.archived_at, s.completed_at,
                u.full_name AS creator_name,
                (SELECT COUNT(*) FROM responses r WHERE r.survey_id = s.id) AS response_count
         FROM surveys s
         JOIN users u ON u.id = s.created_by
         WHERE s.status = 'completed'
         ORDER BY s.completed_at DESC, s.id DESC`
      );
      return res.json(rows.map(mapListItem));
    }

    let rows;
    if (user.role === 'admin' || user.role === 'editor') {
      rows = await query(
        `SELECT s.id, s.title, s.description, s.status, s.created_at, s.archived_at, s.completed_at,
                u.full_name AS creator_name,
                (SELECT COUNT(*) FROM responses r WHERE r.survey_id = s.id) AS response_count
         FROM surveys s
         JOIN users u ON u.id = s.created_by
         WHERE s.status IN ('draft', 'active')
         ORDER BY FIELD(s.status, 'active', 'draft'), s.updated_at DESC`
      );
    } else {
      rows = await query(
        `SELECT s.id, s.title, s.description, s.status, s.created_at, s.archived_at, s.completed_at,
                u.full_name AS creator_name,
                (SELECT COUNT(*) FROM responses r WHERE r.survey_id = s.id) AS response_count
         FROM surveys s
         JOIN users u ON u.id = s.created_by
         JOIN survey_access sa ON sa.survey_id = s.id AND sa.user_id = :userId
         WHERE s.status = 'active'
         ORDER BY s.title`,
        { userId: user.id }
      );
    }

    res.json(rows.map(mapListItem));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось загрузить опросы' });
  }
});

function mapListItem(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
    archivedAt: row.archived_at,
    completedAt: row.completed_at,
    creatorName: row.creator_name,
    responseCount: Number(row.response_count) || 0,
  };
}

router.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const survey = await loadSurveyStructure(id);
    if (!survey) {
      return res.status(404).json({ error: 'Опрос не найден' });
    }

    const { user } = req;
    if (user.role === 'user') {
      if (survey.status !== 'active' || !survey.accessUserIds.includes(user.id)) {
        return res.status(403).json({ error: 'Нет доступа к опросу' });
      }
    } else if (user.role === 'editor' && survey.status === 'archived') {
      return res.status(403).json({ error: 'Архивные опросы доступны только администраторам' });
    }

    res.json(survey);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось загрузить опрос' });
  }
});

/** Create survey (admin, editor) */
router.post('/', requireRoles('admin', 'editor'), async (req, res) => {
  try {
    const { title, description } = req.body || {};
    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: 'Укажите название опроса' });
    }

    const result = await query(
      `INSERT INTO surveys (title, description, status, created_by)
       VALUES (:title, :description, 'draft', :createdBy)`,
      {
        title: String(title).trim(),
        description: description ? String(description).trim() : null,
        createdBy: req.user.id,
      }
    );

    const survey = await loadSurveyStructure(result.insertId);
    res.status(201).json(survey);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось создать опрос' });
  }
});

/** Duplicate survey (structure only) into a new draft */
router.post('/:id/copy', requireRoles('admin', 'editor'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const source = await loadSurveyStructure(id);
    if (!source) {
      return res.status(404).json({ error: 'Опрос не найден' });
    }
    if (req.user.role === 'editor' && source.status === 'archived') {
      return res.status(403).json({ error: 'Архивные опросы доступны только администраторам' });
    }

    const baseTitle = String(source.title || '').trim() || 'Опрос';
    const copyTitle = `${baseTitle} (копия)`.slice(0, 255);

    const newId = await withTransaction(async (conn) => {
      const [created] = await conn.execute(
        `INSERT INTO surveys (title, description, conduct_mode, status, created_by)
         VALUES (:title, :description, :conductMode, 'draft', :createdBy)`,
        {
          title: copyTitle,
          description: source.description || null,
          conductMode: source.conductMode === 'step' ? 'step' : 'scroll',
          createdBy: req.user.id,
        }
      );
      const surveyId = created.insertId;

      await insertQuestionsAndOptions(conn, {
        surveyId,
        questions: source.questions.map((q) => ({
          ...q,
          options: (q.options || []).map((opt) => ({
            ...opt,
            jumpToQuestionIndex: Number.isInteger(opt.jumpToQuestionIndex) ? opt.jumpToQuestionIndex : null,
          })),
        })),
      });

      for (const userId of source.accessUserIds || []) {
        await conn.execute(
          `INSERT INTO survey_access (survey_id, user_id) VALUES (:surveyId, :userId)`,
          { surveyId, userId: Number(userId) }
        );
      }

      return surveyId;
    });

    const survey = await loadSurveyStructure(newId);
    res.status(201).json(survey);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось скопировать опрос' });
  }
});

/** Save full survey structure from constructor */
router.put('/:id', requireRoles('admin', 'editor'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const access = await userCanEditSurvey(req.user, id);
    if (!access.ok) {
      return res.status(access.reason === 'not_found' ? 404 : 403).json({
        error: access.reason === 'not_found' ? 'Опрос не найден' : 'Нет прав на редактирование',
      });
    }

    const {
      title,
      description,
      status,
      questions = [],
      accessUserIds = [],
      conductMode,
    } = req.body || {};

    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: 'Укажите название опроса' });
    }

    const conductModeVal = conductMode === 'step' ? 'step' : 'scroll';

    if (status && !['draft', 'active', 'completed', 'archived'].includes(status)) {
      return res.status(400).json({ error: 'Некорректный статус' });
    }

    if (status === 'archived' && !isAdmin(req.user)) {
      return res.status(403).json({ error: 'В архив могут отправлять только администраторы' });
    }

    for (const q of questions) {
      if (!q.text || !String(q.text).trim()) {
        return res.status(400).json({ error: 'У каждого вопроса должен быть текст' });
      }
      if (!['checkbox', 'text', 'select', 'address'].includes(q.answerType)) {
        return res.status(400).json({ error: 'Тип ответа: checkbox, select, text или address' });
      }
      if (q.answerType === 'checkbox' || q.answerType === 'select') {
        const opts = q.options || [];
        if (!opts.length || opts.some((o) => !o.text || !String(o.text).trim())) {
          return res.status(400).json({
            error:
              q.answerType === 'select'
                ? 'Для выпадающего списка нужны варианты ответов'
                : 'Для вопросов с галочками нужны варианты ответов',
          });
        }
      }
    }

    const jumpError = validateJumpConfiguration(questions);
    if (jumpError) {
      return res.status(400).json({ error: jumpError });
    }

    const [respCountRows] = await query(
      'SELECT COUNT(*) AS cnt FROM responses WHERE survey_id = :id',
      { id }
    );
    const hasResponses = Number(respCountRows.cnt) > 0;

    await withTransaction(async (conn) => {
      const nextStatus = status || access.survey.status;
      const prevStatus = access.survey.status;
      const titleVal = String(title).trim();
      const descVal = description ? String(description).trim() : null;

      if (nextStatus === 'archived' && prevStatus !== 'archived') {
        await conn.execute(
          `UPDATE surveys
           SET title = :title, description = :description, conduct_mode = :conductMode,
               status = 'archived', archived_at = CURRENT_TIMESTAMP
           WHERE id = :id`,
          { id, title: titleVal, description: descVal, conductMode: conductModeVal }
        );
      } else if (nextStatus === 'completed' && prevStatus !== 'completed') {
        await conn.execute(
          `UPDATE surveys
           SET title = :title, description = :description, conduct_mode = :conductMode,
               status = 'completed', completed_at = CURRENT_TIMESTAMP, archived_at = NULL
           WHERE id = :id`,
          { id, title: titleVal, description: descVal, conductMode: conductModeVal }
        );
      } else if (nextStatus === 'draft' || nextStatus === 'active') {
        await conn.execute(
          `UPDATE surveys
           SET title = :title, description = :description, conduct_mode = :conductMode,
               status = :status, archived_at = NULL, completed_at = NULL
           WHERE id = :id`,
          {
            id,
            title: titleVal,
            description: descVal,
            conductMode: conductModeVal,
            status: nextStatus,
          }
        );
      } else {
        await conn.execute(
          `UPDATE surveys
           SET title = :title, description = :description, conduct_mode = :conductMode,
               status = :status
           WHERE id = :id`,
          {
            id,
            title: titleVal,
            description: descVal,
            conductMode: conductModeVal,
            status: nextStatus,
          }
        );
      }

      if (hasResponses) {
        // Structure locked after first response — only meta/access update
      } else {
        await conn.execute('DELETE FROM questions WHERE survey_id = :id', { id });
        await insertQuestionsAndOptions(conn, { surveyId: id, questions });
      }

      await conn.execute('DELETE FROM survey_access WHERE survey_id = :id', { id });
      const uniqueIds = [...new Set((accessUserIds || []).map(Number).filter(Boolean))];
      for (const userId of uniqueIds) {
        await conn.execute(
          `INSERT INTO survey_access (survey_id, user_id) VALUES (:surveyId, :userId)`,
          { surveyId: id, userId }
        );
      }
    });

    const survey = await loadSurveyStructure(id);
    res.json(survey);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось сохранить опрос' });
  }
});

/** Quick complete / archive / restore / activate */
router.patch('/:id/status', requireRoles('admin', 'editor'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body || {};
    if (!['draft', 'active', 'completed', 'archived'].includes(status)) {
      return res.status(400).json({ error: 'Некорректный статус' });
    }

    if (status === 'archived' && !isAdmin(req.user)) {
      return res.status(403).json({ error: 'В архив могут отправлять только администраторы' });
    }

    const access = await userCanEditSurvey(req.user, id);
    if (!access.ok) {
      return res.status(access.reason === 'not_found' ? 404 : 403).json({
        error: access.reason === 'not_found' ? 'Опрос не найден' : 'Нет прав',
      });
    }

    if (status === 'archived') {
      await query(
        `UPDATE surveys SET status = 'archived', archived_at = CURRENT_TIMESTAMP WHERE id = :id`,
        { id }
      );
    } else if (status === 'completed') {
      await query(
        `UPDATE surveys
         SET status = 'completed', completed_at = CURRENT_TIMESTAMP, archived_at = NULL
         WHERE id = :id`,
        { id }
      );
    } else {
      await query(
        `UPDATE surveys
         SET status = :status, archived_at = NULL, completed_at = NULL
         WHERE id = :id`,
        { id, status }
      );
    }

    res.json(await loadSurveyStructure(id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось изменить статус' });
  }
});

/** Delete draft (admin/editor) or archived survey (admin only) */
router.delete('/:id', requireRoles('admin', 'editor'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const rows = await query(`SELECT id, status, title FROM surveys WHERE id = :id`, { id });
    if (!rows.length) {
      return res.status(404).json({ error: 'Опрос не найден' });
    }

    const { status } = rows[0];
    if (status === 'archived') {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Архив могут удалять только администраторы' });
      }
    } else if (status === 'draft') {
      // admin and editor may delete drafts
    } else {
      return res.status(400).json({
        error:
          status === 'completed'
            ? 'Удалить завершённый опрос нельзя. Сначала перенесите его в архив (История).'
            : 'Удалить можно черновик или опрос из архива.',
      });
    }

    await withTransaction(async (conn) => {
      const [responses] = await conn.execute(
        `SELECT id FROM responses WHERE survey_id = :id`,
        { id }
      );
      if (responses.length) {
        const ids = responses.map((r) => r.id).join(',');
        await conn.execute(`DELETE FROM answer_values WHERE response_id IN (${ids})`);
        await conn.execute(`DELETE FROM responses WHERE survey_id = :id`, { id });
      }
      await conn.execute(`DELETE FROM surveys WHERE id = :id`, { id });
    });

    try {
      deleteSurveyAudioDir(id);
    } catch (fileErr) {
      console.error('Audio cleanup failed:', fileErr);
    }

    res.json({ ok: true, id, message: 'Опрос удалён' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось удалить опрос' });
  }
});

router.post('/:id/responses/session', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const can = await userCanConduct(req.user, id);
    if (!can.ok) {
      const map = {
        not_found: [404, 'Опрос не найден'],
        archived: [403, 'Опрос в архиве'],
        completed: [403, 'Опрос завершён'],
        draft: [403, 'Черновик нельзя проводить'],
        forbidden: [403, 'Нет доступа к опросу'],
      };
      const [code, msg] = map[can.reason] || [403, 'Нет доступа'];
      return res.status(code).json({ error: msg });
    }

    const clientSessionId = String(req.body?.clientSessionId || '').trim();
    if (!clientSessionId) {
      return res.status(400).json({ error: 'Не передан clientSessionId' });
    }

    const session = await getOrCreateUploadSession({
      surveyId: id,
      conductedBy: req.user.id,
      clientSessionId,
      audioMime: req.body?.audioMime || null,
      audioDurationSec: Number(req.body?.audioDurationSec) || null,
    });

    res.status(201).json({
      uploadSessionId: session.id,
      clientSessionId: session.client_session_id,
      status: session.status,
      responseId: session.response_id || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось создать сессию загрузки' });
  }
});

router.get('/:id/responses/session/:uploadSessionId/status', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const can = await userCanConduct(req.user, id);
    if (!can.ok) {
      return res.status(403).json({ error: 'Нет доступа' });
    }
    const uploadSession = await loadUploadSession(Number(req.params.uploadSessionId));
    if (
      !uploadSession ||
      Number(uploadSession.survey_id) !== id ||
      Number(uploadSession.conducted_by) !== Number(req.user.id)
    ) {
      return res.status(404).json({ error: 'Сессия загрузки не найдена' });
    }

    res.json({
      uploadSessionId: uploadSession.id,
      clientSessionId: uploadSession.client_session_id,
      status: uploadSession.status,
      totalChunks: Number(uploadSession.total_chunks) || 0,
      uploadedChunkIndexes: await listUploadChunkIndexes(uploadSession.id),
      responseId: uploadSession.response_id || null,
      lastError: uploadSession.last_error || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось получить статус загрузки' });
  }
});

router.post(
  '/:id/responses/session/:uploadSessionId/chunks',
  uploadAudio.single('chunk'),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const can = await userCanConduct(req.user, id);
      if (!can.ok) {
        return res.status(403).json({ error: 'Нет доступа' });
      }
      const uploadSession = await loadUploadSession(Number(req.params.uploadSessionId));
      if (
        !uploadSession ||
        Number(uploadSession.survey_id) !== id ||
        Number(uploadSession.conducted_by) !== Number(req.user.id)
      ) {
        return res.status(404).json({ error: 'Сессия загрузки не найдена' });
      }
      if (uploadSession.status === 'finalized') {
        return res.json({
          uploadSessionId: uploadSession.id,
          chunkIndex: Number(req.body?.chunkIndex) || 0,
          alreadyUploaded: true,
          finalized: true,
        });
      }
      if (!req.file?.buffer?.length) {
        return res.status(400).json({ error: 'Не передан аудиофрагмент' });
      }
      if (!isAllowedAudioMime(req.file.mimetype)) {
        return res.status(400).json({ error: 'Неподдерживаемый формат аудио' });
      }
      const chunkIndex = Number(req.body?.chunkIndex);
      if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
        return res.status(400).json({ error: 'Некорректный номер аудиофрагмента' });
      }

      const existingIndexes = await listUploadChunkIndexes(uploadSession.id);
      const alreadyUploaded = existingIndexes.includes(chunkIndex);
      if (!alreadyUploaded) {
        const saved = await saveUploadChunk({
          uploadSessionId: uploadSession.id,
          chunkIndex,
          buffer: req.file.buffer,
          mime: req.file.mimetype,
        });
        await upsertUploadChunk({
          uploadSessionId: uploadSession.id,
          chunkIndex,
          chunkSize: saved.size,
          relativePath: saved.relativePath,
        });
      }
      await markUploadSessionProgress({
        uploadSessionId: uploadSession.id,
        status: 'uploading',
        audioMime: req.file.mimetype,
        audioDurationSec: Number(req.body?.audioDurationSec) || null,
        totalChunks: chunkIndex + 1,
      });

      res.status(alreadyUploaded ? 200 : 201).json({
        uploadSessionId: uploadSession.id,
        chunkIndex,
        alreadyUploaded,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Не удалось сохранить аудиофрагмент' });
    }
  }
);

router.post('/:id/responses/session/:uploadSessionId/finalize', async (req, res) => {
  const id = Number(req.params.id);
  try {
    const can = await userCanConduct(req.user, id);
    if (!can.ok) {
      return res.status(403).json({ error: 'Нет доступа' });
    }
    const uploadSession = await loadUploadSession(Number(req.params.uploadSessionId));
    if (
      !uploadSession ||
      Number(uploadSession.survey_id) !== id ||
      Number(uploadSession.conducted_by) !== Number(req.user.id)
    ) {
      return res.status(404).json({ error: 'Сессия загрузки не найдена' });
    }

    const payload = req.body?.payload || {};
    const survey = await loadSurveyStructure(id);
    validateResponsePayload(survey, payload);
    const result = await finalizeUploadSession({
      uploadSession,
      survey,
      payload,
      totalChunks: Math.max(0, Number(req.body?.totalChunks) || 0),
      hasAudio: !!req.body?.hasAudio,
    });

    res.status(result.reused ? 200 : 201).json({
      id: result.responseId,
      hasAudio: result.hasAudio,
      message: result.hasAudio
        ? 'Проведение сохранено с аудиозаписью'
        : 'Проведение сохранено без аудиозаписи',
    });
  } catch (err) {
    await failUploadSession(Number(req.params.uploadSessionId), err.message);
    console.error(err);
    const msg = err.message || 'Не удалось завершить загрузку';
    const isValidation =
      /Ответьте на вопрос|Выберите ответ|Некорректный вариант|Укажите текст|аудиофрагмент/i.test(
        msg
      );
    res.status(isValidation ? 400 : 500).json({ error: msg });
  }
});

/** Submit conducted survey answers + voice recording */
router.post('/:id/responses', uploadAudio.single('audio'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const can = await userCanConduct(req.user, id);
    if (!can.ok) {
      const map = {
        not_found: [404, 'Опрос не найден'],
        archived: [403, 'Опрос в архиве'],
        completed: [403, 'Опрос завершён'],
        draft: [403, 'Черновик нельзя проводить'],
        forbidden: [403, 'Нет доступа к опросу'],
      };
      const [code, msg] = map[can.reason] || [403, 'Нет доступа'];
      return res.status(code).json({ error: msg });
    }

    const hasAudio = !!(req.file && req.file.buffer?.length);
    if (hasAudio && !isAllowedAudioMime(req.file.mimetype)) {
      return res.status(400).json({ error: 'Неподдерживаемый формат аудио' });
    }

    let payload;
    try {
      payload = JSON.parse(req.body.payload || '{}');
    } catch {
      return res.status(400).json({ error: 'Некорректные данные ответов' });
    }

    const survey = await loadSurveyStructure(id);
    const audioDurationSec = Number(req.body.audioDurationSec) || null;
    let responseId;
    try {
      responseId = await createSurveyResponseRecord({
        surveyId: id,
        conductedBy: req.user.id,
        payload,
        survey,
      });
    } catch (validationErr) {
      return res.status(400).json({ error: validationErr.message });
    }

    if (hasAudio) {
      try {
        const saved = await saveResponseAudio({
          surveyId: id,
          responseId,
          buffer: req.file.buffer,
          mime: req.file.mimetype,
        });
        await query(
          `UPDATE responses
           SET audio_path = :audioPath, audio_mime = :audioMime, audio_size = :audioSize,
               audio_duration_sec = :audioDurationSec
           WHERE id = :id`,
          {
            id: responseId,
            audioPath: saved.relativePath,
            audioMime: saved.mime,
            audioSize: saved.size,
            audioDurationSec: audioDurationSec > 0 ? Math.round(audioDurationSec) : null,
          }
        );
      } catch (fileErr) {
        await query('DELETE FROM responses WHERE id = :id', { id: responseId });
        console.error(fileErr);
        return res.status(500).json({ error: 'Не удалось сохранить аудиозапись' });
      }
    }

    res.status(201).json({
      id: responseId,
      message: hasAudio ? 'Проведение сохранено с аудиозаписью' : 'Проведение сохранено без аудиозаписи',
      hasAudio,
    });
  } catch (err) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Аудиофайл слишком большой' });
    }
    console.error(err);
    res.status(500).json({ error: err.message || 'Не удалось сохранить ответы' });
  }
});

/** CSV export for one survey (all respondents) — Excel-friendly */
router.get('/:id/responses/export.csv', requireRoles('admin', 'editor'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const view = await userCanViewSurveyResults(req.user, id);
    if (!view.ok) {
      return res.status(view.reason === 'not_found' ? 404 : 403).json({
        error: view.reason === 'not_found' ? 'Опрос не найден' : 'Нет доступа',
      });
    }

    const survey = await loadSurveyStructure(id);
    if (!survey) return res.status(404).json({ error: 'Опрос не найден' });

    const responses = await query(
      `SELECT r.id, r.respondent_note, r.created_at, r.audio_path, r.audio_duration_sec,
              u.full_name AS conductor_name, u.login AS conductor_login
       FROM responses r
       JOIN users u ON u.id = r.conducted_by
       WHERE r.survey_id = :id
       ORDER BY r.created_at ASC`,
      { id }
    );

    const questions = survey.questions || [];
    const header = [
      '№',
      'ID проведения',
      'Дата',
      'Провёл',
      'Пометка',
      'Аудио',
      'Длительность аудио (сек)',
      ...questions.map((q, i) => `В${i + 1}. ${q.text}`),
    ];

    let byResponse = new Map();
    if (responses.length) {
      const answerRows = await query(
        `SELECT av.response_id, av.question_id, av.option_id, av.text_value, o.text AS option_text
         FROM answer_values av
         LEFT JOIN options o ON o.id = av.option_id
         WHERE av.response_id IN (${responses.map((r) => r.id).join(',')})`
      );
      for (const a of answerRows) {
        if (!byResponse.has(a.response_id)) byResponse.set(a.response_id, []);
        byResponse.get(a.response_id).push(a);
      }
    }

    const rows = [header];
    responses.forEach((r, index) => {
      const answers = byResponse.get(r.id) || [];
      const cells = questions.map((q) => {
        const ans = answers.filter((a) => a.question_id === q.id);
        if (q.answerType === 'text' || q.answerType === 'address') return ans[0]?.text_value || '';
        return ans
          .map((a) => formatOptionAnswer(a.option_text, a.text_value))
          .filter(Boolean)
          .join(', ');
      });
      const created =
        r.created_at instanceof Date
          ? r.created_at.toISOString().replace('T', ' ').slice(0, 19)
          : String(r.created_at || '');
      rows.push([
        index + 1,
        r.id,
        created,
        r.conductor_name || r.conductor_login || '',
        r.respondent_note || '',
        r.audio_path ? 'да' : 'нет',
        r.audio_duration_sec || '',
        ...cells,
      ]);
    });

    const body = csvWithBom(toCsv(rows));
    const utfName = `${safeFilename(survey.title, `opros_${id}`)}_results.csv`;
    const asciiName = `opros_${id}_results.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    // filename= must be ASCII-only (Node rejects Cyrillic in header values)
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(utfName)}`
    );
    res.send(body);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось сформировать CSV' });
  }
});

/** Stream audio for a conducted session */
router.get('/:id/responses/:responseId/audio', async (req, res) => {
  try {
    const surveyId = Number(req.params.id);
    const responseId = Number(req.params.responseId);
    const view = await userCanViewSurveyResults(req.user, surveyId);
    if (!view.ok) {
      return res.status(view.reason === 'not_found' ? 404 : 403).json({
        error: view.reason === 'not_found' ? 'Опрос не найден' : 'Нет доступа',
      });
    }

    const rows = await query(
      `SELECT audio_path, audio_mime, audio_size
       FROM responses
       WHERE id = :responseId AND survey_id = :surveyId`,
      { responseId, surveyId }
    );
    if (!rows.length || !rows[0].audio_path) {
      return res.status(404).json({ error: 'Аудиозапись не найдена' });
    }

    const full = absoluteAudioPath(rows[0].audio_path);
    if (!full || !fs.existsSync(full)) {
      return res.status(404).json({ error: 'Файл записи отсутствует на сервере' });
    }

    const stat = fs.statSync(full);
    const mime = rows[0].audio_mime || 'audio/webm';
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    fs.createReadStream(full).pipe(res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось отдать аудиозапись' });
  }
});

/** List responses for a survey (managers) */
router.get('/:id/responses', requireRoles('admin', 'editor'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const view = await userCanViewSurveyResults(req.user, id);
    if (!view.ok) {
      return res.status(view.reason === 'not_found' ? 404 : 403).json({
        error: view.reason === 'not_found' ? 'Опрос не найден' : 'Нет доступа',
      });
    }

    const survey = await loadSurveyStructure(id);
    if (!survey) return res.status(404).json({ error: 'Опрос не найден' });

    const responses = await query(
      `SELECT r.id, r.respondent_note, r.created_at,
              r.audio_path, r.audio_mime, r.audio_size, r.audio_duration_sec,
              u.full_name AS conductor_name, u.login AS conductor_login
       FROM responses r
       JOIN users u ON u.id = r.conducted_by
       WHERE r.survey_id = :id
       ORDER BY r.created_at ASC`,
      { id }
    );

    if (!responses.length) {
      return res.json({ surveyId: id, items: [] });
    }

    const answerRows = await query(
      `SELECT av.response_id, av.question_id, av.option_id, av.text_value, o.text AS option_text
       FROM answer_values av
       LEFT JOIN options o ON o.id = av.option_id
       WHERE av.response_id IN (${responses.map((r) => r.id).join(',')})`
    );

    const byResponse = new Map();
    for (const a of answerRows) {
      if (!byResponse.has(a.response_id)) byResponse.set(a.response_id, []);
      byResponse.get(a.response_id).push({
        questionId: a.question_id,
        optionId: a.option_id,
        optionText: a.option_text,
        textValue: a.text_value,
      });
    }

    const items = responses.map((r, index) => ({
      id: r.id,
      sessionNumber: index + 1,
      respondentNote: r.respondent_note,
      createdAt: r.created_at,
      conductorName: r.conductor_name || r.conductor_login,
      hasAudio: !!r.audio_path,
      audioMime: r.audio_mime,
      audioSize: r.audio_size,
      audioDurationSec: r.audio_duration_sec,
      answers: byResponse.get(r.id) || [],
    }));

    items.reverse();

    res.json({ surveyId: id, items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось загрузить ответы' });
  }
});

export default router;
