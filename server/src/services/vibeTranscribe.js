const VIBE_BASE_URL = 'https://vibecode.bitrix24.tech/v1';
const TRANSCRIBE_URL = `${VIBE_BASE_URL}/audio/transcriptions`;
const CHAT_URL = `${VIBE_BASE_URL}/chat/completions`;
const WHISPER_MODEL = 'bitrix/deepdml/faster-whisper-large-v3-turbo-ct2';
const CHAT_MODEL = 'bitrix/bitrixgpt-5.5';

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Word ignores CSS white-space on HTML/.doc — use real <br> breaks. */
export function docHtmlFromText({ title, text }) {
  const bodyHtml = escapeHtml(text || '').replace(/\r\n|\r|\n/g, '<br>\n');
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title || 'Опрос')}</title>
  </head>
  <body style="font-family: Arial, sans-serif; font-size: 12pt; line-height: 1.45;">
    ${bodyHtml}
  </body>
</html>`;
}

export function looksLikeRepetitionLoop(text) {
  const compact = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (compact.length < 24) return false;
  return /^(.{6,60}?)([.!?…,;:\s]+\1){5,}/u.test(compact);
}

export function linesFromVerboseResult(raw, fallbackText) {
  const segments = Array.isArray(raw?.segments) ? raw.segments : [];
  const fromSegments = segments
    .map((seg) => String(seg?.text || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (fromSegments.length) return fromSegments.join('\n');
  return String(fallbackText || '')
    .replace(/([.!?…])\s+/g, '$1\n')
    .trim();
}

/**
 * Force each role utterance onto its own line, even if the model
 * returned "Role: a Role: b" on one line.
 */
export function ensureRoleNewlines(text, labels = []) {
  let out = String(text || '').replace(/\r\n|\r/g, '\n').trim();
  const names = [...new Set(labels.map((x) => String(x || '').trim()).filter(Boolean))];
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`\\s+(${escaped}\\s*:)`, 'giu'), '\n$1');
  }
  // Common fallbacks if custom names were not passed through cleanly.
  out = out.replace(/\s+(Опрашивающий\s*:)/giu, '\n$1');
  out = out.replace(/\s+(Респондент\s*:)/giu, '\n$1');
  out = out.replace(/\s+(Администратор\s*:)/giu, '\n$1');
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

export async function transcribeAudioViaVibe({
  apiKey,
  modelId = WHISPER_MODEL,
  language = 'ru',
  prompt,
  audioBuffer,
  mime,
  hotwords,
  temperature = 0,
  vadFilter = false,
  responseFormat = 'verbose_json',
}) {
  if (!apiKey) {
    throw new Error('VIBE_API_KEY не задан (проставьте в env на сервере)');
  }
  if (!audioBuffer || !audioBuffer.length) {
    throw new Error('Пустой аудиофайл');
  }
  const form = new FormData();
  const blob = new Blob([audioBuffer], { type: mime || 'audio/webm' });
  form.append('file', blob, 'audio.webm');
  if (language) form.append('language', language);
  if (modelId) form.append('model', modelId);
  if (prompt) form.append('prompt', prompt);
  if (hotwords) form.append('hotwords', hotwords);
  if (typeof temperature === 'number') form.append('temperature', String(temperature));
  if (typeof vadFilter === 'boolean') form.append('vad_filter', String(vadFilter));
  form.append('response_format', responseFormat);

  const res = await fetch(TRANSCRIBE_URL, {
    method: 'POST',
    headers: { 'X-Api-Key': apiKey },
    body: form,
  });

  const data = responseFormat === 'text' ? await res.text() : await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      data?.error?.message ||
      data?.error?.type ||
      data?.message ||
      (typeof data === 'string' ? data : `VibeCode ошибка: ${res.status}`);
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  const text = typeof data === 'string' ? data : data?.text;
  if (!text) {
    throw new Error('VibeCode не вернул поле text');
  }
  return { text, raw: typeof data === 'string' ? { text: data } : data };
}

export async function formatTranscriptByRoles({
  apiKey,
  transcript,
  interviewerLabel = 'Опрашивающий',
  respondentLabel = 'Респондент',
}) {
  const res = await fetch(CHAT_URL, {
    method: 'POST',
    headers: {
      'X-Api-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'Ты оформляешь уже готовую расшифровку социологического опроса. ' +
            'Нельзя добавлять, выдумывать, пересказывать или выкидывать слова. ' +
            'Можно только разбить текст по строкам и при необходимости подписать роли. ' +
            'Каждая реплика обязательно с новой строки.',
        },
        {
          role: 'user',
          content:
            `В записи обычно двое: ${interviewerLabel} и ${respondentLabel}.\n` +
            `Формат строго такой (каждая реплика на отдельной строке):\n` +
            `${interviewerLabel}: текст\n` +
            `${respondentLabel}: текст\n` +
            'Если роли неясны или слышен один голос, всё равно пиши по одной реплике/фразе на строку.\n' +
            'Не склеивай несколько реплик в одну строку.\n' +
            'Верни только оформленный протокол.\n\n' +
            `РАСШИФРОВКА:\n${transcript}`,
        },
      ],
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.error?.message || 'Не удалось оформить протокол');
    err.status = res.status;
    throw err;
  }
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('Модель не вернула оформленный текст');
  return ensureRoleNewlines(String(text).trim(), [interviewerLabel, respondentLabel]);
}

export async function transcribeSurveyAudio({ apiKey, audioBuffer, mime, interviewerLabel, respondentLabel }) {
  const first = await transcribeAudioViaVibe({
    apiKey,
    audioBuffer,
    mime,
    language: 'ru',
    temperature: 0,
    vadFilter: false,
    responseFormat: 'verbose_json',
  });
  let body = linesFromVerboseResult(first.raw, first.text);

  if (looksLikeRepetitionLoop(body)) {
    const retry = await transcribeAudioViaVibe({
      apiKey,
      audioBuffer,
      mime,
      language: 'ru',
      temperature: 0.2,
      vadFilter: false,
      responseFormat: 'verbose_json',
    });
    const retryBody = linesFromVerboseResult(retry.raw, retry.text);
    if (!looksLikeRepetitionLoop(retryBody)) body = retryBody;
  }

  try {
    body = await formatTranscriptByRoles({
      apiKey,
      transcript: body,
      interviewerLabel,
      respondentLabel,
    });
  } catch (err) {
    console.error('role formatting skipped', err);
    body = ensureRoleNewlines(body, [interviewerLabel, respondentLabel]);
  }

  return ensureRoleNewlines(body, [interviewerLabel, respondentLabel]);
}
