import fs from 'fs';
import path from 'path';
import { query, withTransaction } from '../db.js';
import {
  absoluteUploadChunkPath,
  deleteUploadSessionAudioDir,
  saveResponseAudio,
} from './audioStorage.js';
import { buildReachableQuestionIds } from './jumpLogic.js';
import { isOtherOptionText } from './optionHelpers.js';

export function validateResponsePayload(survey, payload) {
  const { answers = [] } = payload || {};
  const answersByQuestionId = new Map(
    (answers || []).map((a) => [Number(a.questionId), a])
  );
  const reachableQuestionIds = new Set(
    buildReachableQuestionIds(survey.questions, answersByQuestionId)
  );

  for (const q of survey.questions) {
    if (!reachableQuestionIds.has(Number(q.id))) continue;
    const ans = answers.find((a) => Number(a.questionId) === q.id);
    if (q.isRequired) {
      if (q.answerType === 'text' || q.answerType === 'address') {
        if (!ans || !String(ans.textValue || '').trim()) {
          throw new Error(`Ответьте на вопрос: ${q.text}`);
        }
      } else {
        const selected = (ans && ans.optionIds) || [];
        if (!selected.length) {
          throw new Error(`Выберите ответ: ${q.text}`);
        }
      }
    }
    if (
      (q.answerType === 'checkbox' || q.answerType === 'select') &&
      ans?.optionIds?.length
    ) {
      const singleChoice =
        q.answerType === 'select' || (q.answerType === 'checkbox' && !q.allowMultiple);
      if (singleChoice && ans.optionIds.length > 1) {
        throw new Error('Можно выбрать только один вариант');
      }
      const validIds = new Set(q.options.map((o) => o.id));
      const otherTexts = ans.otherTexts || {};
      for (const oid of ans.optionIds) {
        const oidNum = Number(oid);
        if (!validIds.has(oidNum)) {
          throw new Error('Некорректный вариант ответа');
        }
        const opt = q.options.find((o) => o.id === oidNum);
        if (opt && isOtherOptionText(opt.text)) {
          const extra = String(
            otherTexts[oidNum] ?? otherTexts[String(oidNum)] ?? ''
          ).trim();
          if (!extra) {
            throw new Error(
              `Укажите текст для варианта «${opt.text}» в вопросе: ${q.text}`
            );
          }
        }
      }
    }
  }

  return {
    answers,
    reachableQuestionIds,
  };
}

export async function createSurveyResponseRecord({
  surveyId,
  conductedBy,
  payload,
  survey,
}) {
  const { answers, reachableQuestionIds } = validateResponsePayload(survey, payload);
  return withTransaction(async (conn) => {
    const [resp] = await conn.execute(
      `INSERT INTO responses (survey_id, conducted_by, respondent_note)
       VALUES (:surveyId, :conductedBy, :note)`,
      {
        surveyId,
        conductedBy,
        note: payload.respondentNote ? String(payload.respondentNote).trim() : null,
      }
    );
    const responseId = resp.insertId;

    for (const q of survey.questions) {
      if (!reachableQuestionIds.has(Number(q.id))) continue;
      const ans = answers.find((a) => Number(a.questionId) === q.id);
      if (!ans) continue;

      if (q.answerType === 'text' || q.answerType === 'address') {
        const text = String(ans.textValue || '').trim();
        if (!text) continue;
        await conn.execute(
          `INSERT INTO answer_values (response_id, question_id, text_value)
           VALUES (:responseId, :questionId, :textValue)`,
          { responseId, questionId: q.id, textValue: text }
        );
      } else {
        const otherTexts = ans.otherTexts || {};
        for (const oid of ans.optionIds || []) {
          const oidNum = Number(oid);
          const opt = q.options.find((o) => o.id === oidNum);
          let textValue = null;
          if (opt && isOtherOptionText(opt.text)) {
            textValue =
              String(otherTexts[oidNum] ?? otherTexts[String(oidNum)] ?? '').trim() ||
              null;
          }
          await conn.execute(
            `INSERT INTO answer_values (response_id, question_id, option_id, text_value)
             VALUES (:responseId, :questionId, :optionId, :textValue)`,
            {
              responseId,
              questionId: q.id,
              optionId: oidNum,
              textValue,
            }
          );
        }
      }
    }

    return responseId;
  });
}

export async function getOrCreateUploadSession({
  surveyId,
  conductedBy,
  clientSessionId,
  audioMime,
  audioDurationSec,
}) {
  const existing = await query(
    `SELECT * FROM response_upload_sessions WHERE client_session_id = :clientSessionId LIMIT 1`,
    { clientSessionId }
  );
  if (existing.length) return existing[0];

  await query(
    `INSERT INTO response_upload_sessions
      (survey_id, conducted_by, client_session_id, status, audio_mime, audio_duration_sec)
     VALUES
      (:surveyId, :conductedBy, :clientSessionId, 'active', :audioMime, :audioDurationSec)`,
    {
      surveyId,
      conductedBy,
      clientSessionId,
      audioMime: audioMime || null,
      audioDurationSec: audioDurationSec > 0 ? Math.round(audioDurationSec) : null,
    }
  );
  const rows = await query(
    `SELECT * FROM response_upload_sessions WHERE client_session_id = :clientSessionId LIMIT 1`,
    { clientSessionId }
  );
  return rows[0];
}

export async function loadUploadSession(uploadSessionId) {
  const rows = await query(
    `SELECT * FROM response_upload_sessions WHERE id = :id LIMIT 1`,
    { id: uploadSessionId }
  );
  return rows[0] || null;
}

export async function loadUploadSessionByClientId(clientSessionId) {
  const rows = await query(
    `SELECT * FROM response_upload_sessions WHERE client_session_id = :clientSessionId LIMIT 1`,
    { clientSessionId }
  );
  return rows[0] || null;
}

export async function listUploadChunkIndexes(uploadSessionId) {
  const rows = await query(
    `SELECT chunk_index FROM response_upload_chunks
     WHERE upload_session_id = :uploadSessionId
     ORDER BY chunk_index ASC`,
    { uploadSessionId }
  );
  return rows.map((row) => Number(row.chunk_index));
}

export async function upsertUploadChunk({
  uploadSessionId,
  chunkIndex,
  chunkSize,
  relativePath,
}) {
  await query(
    `INSERT INTO response_upload_chunks
      (upload_session_id, chunk_index, chunk_size, relative_path)
     VALUES
      (:uploadSessionId, :chunkIndex, :chunkSize, :relativePath)
     ON DUPLICATE KEY UPDATE
      chunk_size = VALUES(chunk_size),
      relative_path = VALUES(relative_path)`,
    {
      uploadSessionId,
      chunkIndex,
      chunkSize,
      relativePath,
    }
  );
}

export async function markUploadSessionProgress({
  uploadSessionId,
  status,
  audioMime,
  audioDurationSec,
  totalChunks,
  lastError,
}) {
  await query(
    `UPDATE response_upload_sessions
     SET status = :status,
         audio_mime = COALESCE(:audioMime, audio_mime),
         audio_duration_sec = COALESCE(:audioDurationSec, audio_duration_sec),
         total_chunks = GREATEST(total_chunks, :totalChunks),
         last_error = :lastError
     WHERE id = :uploadSessionId`,
    {
      uploadSessionId,
      status,
      audioMime: audioMime || null,
      audioDurationSec: audioDurationSec > 0 ? Math.round(audioDurationSec) : null,
      totalChunks: totalChunks || 0,
      lastError: lastError || null,
    }
  );
}

export async function finalizeUploadSession({
  uploadSession,
  survey,
  payload,
  totalChunks,
  hasAudio,
}) {
  if (uploadSession.response_id) {
    return {
      responseId: Number(uploadSession.response_id),
      reused: true,
      hasAudio: !!hasAudio,
    };
  }

  const chunkRows = hasAudio
    ? await query(
        `SELECT chunk_index, relative_path
         FROM response_upload_chunks
         WHERE upload_session_id = :uploadSessionId
         ORDER BY chunk_index ASC`,
        { uploadSessionId: uploadSession.id }
      )
    : [];

  if (hasAudio && chunkRows.length !== totalChunks) {
    throw new Error('Не все аудиофрагменты загружены на сервер');
  }
  if (hasAudio) {
    for (let i = 0; i < totalChunks; i++) {
      if (Number(chunkRows[i]?.chunk_index) !== i) {
        throw new Error('Нарушена последовательность аудиофрагментов');
      }
    }
  }

  const responseId = await createSurveyResponseRecord({
    surveyId: survey.id,
    conductedBy: uploadSession.conducted_by,
    payload,
    survey,
  });

  if (hasAudio) {
    try {
      const buffers = [];
      for (const row of chunkRows) {
        const full = absoluteUploadChunkPath(row.relative_path);
        if (!full || !fs.existsSync(full)) {
          throw new Error('Не найден файл аудиофрагмента');
        }
        buffers.push(await fs.promises.readFile(full));
      }
      const combined = Buffer.concat(buffers);
      const saved = await saveResponseAudio({
        surveyId: survey.id,
        responseId,
        buffer: combined,
        mime: uploadSession.audio_mime || 'audio/webm',
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
          audioDurationSec:
            uploadSession.audio_duration_sec > 0
              ? Math.round(uploadSession.audio_duration_sec)
              : null,
        }
      );
    } catch (err) {
      await query('DELETE FROM responses WHERE id = :id', { id: responseId });
      throw err;
    }
  }

  await query(
    `UPDATE response_upload_sessions
     SET status = 'finalized',
         total_chunks = :totalChunks,
         response_id = :responseId,
         last_error = NULL,
         finalized_at = CURRENT_TIMESTAMP
     WHERE id = :id`,
    { id: uploadSession.id, totalChunks, responseId }
  );
  deleteUploadSessionAudioDir(uploadSession.id);

  return {
    responseId,
    reused: false,
    hasAudio: !!hasAudio,
  };
}

export async function failUploadSession(uploadSessionId, errorMessage) {
  await query(
    `UPDATE response_upload_sessions
     SET status = 'failed', last_error = :lastError
     WHERE id = :uploadSessionId`,
    {
      uploadSessionId,
      lastError: String(errorMessage || '').slice(0, 500) || null,
    }
  );
}
