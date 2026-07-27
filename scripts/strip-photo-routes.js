import fs from 'fs';

const p = 'server/src/routes/surveys.js';
let s = fs.readFileSync(p, 'utf8');

const startMarker = "/** Submit conducted survey answers + optional voice recording + optional photo */";
const endMarker = "/** CSV export for one survey";
const start = s.indexOf(startMarker);
const end = s.indexOf(endMarker);
if (start < 0 || end < 0) {
  throw new Error(`markers not found start=${start} end=${end}`);
}

const replacement = `/** Submit conducted survey answers + voice recording */
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
    const { answers = [], respondentNote } = payload;
    const audioDurationSec = Number(req.body.audioDurationSec) || null;

    for (const q of survey.questions) {
      const ans = answers.find((a) => Number(a.questionId) === q.id);
      if (q.isRequired) {
        if (q.answerType === 'text' || q.answerType === 'address') {
          if (!ans || !String(ans.textValue || '').trim()) {
            return res.status(400).json({ error: \`Ответьте на вопрос: \${q.text}\` });
          }
        } else {
          const selected = (ans && ans.optionIds) || [];
          if (!selected.length) {
            return res.status(400).json({ error: \`Выберите ответ: \${q.text}\` });
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
          return res.status(400).json({ error: 'Можно выбрать только один вариант' });
        }
        const validIds = new Set(q.options.map((o) => o.id));
        const otherTexts = ans.otherTexts || {};
        for (const oid of ans.optionIds) {
          const oidNum = Number(oid);
          if (!validIds.has(oidNum)) {
            return res.status(400).json({ error: 'Некорректный вариант ответа' });
          }
          const opt = q.options.find((o) => o.id === oidNum);
          if (opt && isOtherOptionText(opt.text)) {
            const extra = String(
              otherTexts[oidNum] ?? otherTexts[String(oidNum)] ?? ''
            ).trim();
            if (!extra) {
              return res.status(400).json({
                error: \`Укажите текст для варианта «\${opt.text}» в вопросе: \${q.text}\`,
              });
            }
          }
        }
      }
    }

    const responseId = await withTransaction(async (conn) => {
      const [resp] = await conn.execute(
        \`INSERT INTO responses (survey_id, conducted_by, respondent_note)
         VALUES (:surveyId, :conductedBy, :note)\`,
        {
          surveyId: id,
          conductedBy: req.user.id,
          note: respondentNote ? String(respondentNote).trim() : null,
        }
      );
      const rid = resp.insertId;

      for (const q of survey.questions) {
        const ans = answers.find((a) => Number(a.questionId) === q.id);
        if (!ans) continue;

        if (q.answerType === 'text' || q.answerType === 'address') {
          const text = String(ans.textValue || '').trim();
          if (!text) continue;
          await conn.execute(
            \`INSERT INTO answer_values (response_id, question_id, text_value)
             VALUES (:responseId, :questionId, :textValue)\`,
            { responseId: rid, questionId: q.id, textValue: text }
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
              \`INSERT INTO answer_values (response_id, question_id, option_id, text_value)
               VALUES (:responseId, :questionId, :optionId, :textValue)\`,
              {
                responseId: rid,
                questionId: q.id,
                optionId: oidNum,
                textValue,
              }
            );
          }
        }
      }

      return rid;
    });

    if (hasAudio) {
      try {
        const saved = await saveResponseAudio({
          surveyId: id,
          responseId,
          buffer: req.file.buffer,
          mime: req.file.mimetype,
        });
        await query(
          \`UPDATE responses
           SET audio_path = :audioPath, audio_mime = :audioMime, audio_size = :audioSize,
               audio_duration_sec = :audioDurationSec
           WHERE id = :id\`,
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

`;

s = s.slice(0, start) + replacement + s.slice(end);

// Remove photo stream route
const photoStart = s.indexOf("/** Stream photo for a conducted session */");
const listStart = s.indexOf("/** List responses for a survey (managers) */");
if (photoStart >= 0 && listStart > photoStart) {
  s = s.slice(0, photoStart) + s.slice(listStart);
}

// CSV: remove photo
s = s.replace(
  `SELECT r.id, r.respondent_note, r.created_at, r.audio_path, r.audio_duration_sec,
              r.photo_path,
              u.full_name AS conductor_name, u.login AS conductor_login`,
  `SELECT r.id, r.respondent_note, r.created_at, r.audio_path, r.audio_duration_sec,
              u.full_name AS conductor_name, u.login AS conductor_login`
);
s = s.replace(
  `      'Аудио',
      'Длительность аудио (сек)',
      'Фото',
      ...questions.map((q, i) => \`В\${i + 1}. \${q.text}\`),`,
  `      'Аудио',
      'Длительность аудио (сек)',
      ...questions.map((q, i) => \`В\${i + 1}. \${q.text}\`),`
);
s = s.replace(
  `        r.audio_path ? 'да' : 'нет',
        r.audio_duration_sec || '',
        r.photo_path ? 'да' : 'нет',
        ...cells,`,
  `        r.audio_path ? 'да' : 'нет',
        r.audio_duration_sec || '',
        ...cells,`
);

// List responses
s = s.replace(
  `SELECT r.id, r.respondent_note, r.created_at,
              r.audio_path, r.audio_mime, r.audio_size, r.audio_duration_sec,
              r.photo_path, r.photo_mime, r.photo_size,
              u.full_name AS conductor_name, u.login AS conductor_login`,
  `SELECT r.id, r.respondent_note, r.created_at,
              r.audio_path, r.audio_mime, r.audio_size, r.audio_duration_sec,
              u.full_name AS conductor_name, u.login AS conductor_login`
);
s = s.replace(
  `      hasAudio: !!r.audio_path,
      audioMime: r.audio_mime,
      audioSize: r.audio_size,
      audioDurationSec: r.audio_duration_sec,
      hasPhoto: !!r.photo_path,
      photoMime: r.photo_mime,
      photoSize: r.photo_size,
      answers: byResponse.get(r.id) || [],`,
  `      hasAudio: !!r.audio_path,
      audioMime: r.audio_mime,
      audioSize: r.audio_size,
      audioDurationSec: r.audio_duration_sec,
      answers: byResponse.get(r.id) || [],`
);

fs.writeFileSync(p, s);
console.log('surveys.js cleaned of photo');
