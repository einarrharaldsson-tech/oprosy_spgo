const VIBE_BASE_URL = 'https://vibecode.bitrix24.tech/v1';
const TRANSCRIBE_URL = `${VIBE_BASE_URL}/audio/transcriptions`;

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function docHtmlFromText({ title, text }) {
  // Word нормально открывает HTML, если отдать с расширением .doc
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title || 'Опрос')}</title>
  </head>
  <body style="font-family: Arial, sans-serif; font-size: 12pt; white-space: pre-wrap;">
    ${escapeHtml(text || '')}
  </body>
</html>`;
}

export async function transcribeAudioViaVibe({
  apiKey,
  modelId,
  language,
  prompt,
  audioBuffer,
  mime,
  hotwords,
  temperature,
  vadFilter,
}) {
  if (!apiKey) {
    throw new Error('VIBE_API_KEY не задан (проставьте в env на сервере)');
  }
  if (!audioBuffer || !audioBuffer.length) {
    throw new Error('Пустой аудиофайл');
  }
  const form = new FormData();
  const blob = new Blob([audioBuffer], { type: mime || 'audio/webm' });

  // Поле multipart обязанo называться именно "file"
  form.append('file', blob, 'audio');
  if (language) form.append('language', language);
  if (modelId) form.append('model', modelId);
  if (prompt) form.append('prompt', prompt);
  if (hotwords) form.append('hotwords', hotwords);
  if (typeof temperature === 'number') form.append('temperature', String(temperature));
  if (typeof vadFilter === 'boolean') form.append('vad_filter', String(vadFilter));
  form.append('response_format', 'json');

  const res = await fetch(TRANSCRIBE_URL, {
    method: 'POST',
    headers: {
      'X-Api-Key': apiKey,
    },
    body: form,
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data?.error?.message || data?.error?.type || data?.message || `VibeCode ошибка: ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  // Для response_format=json ответ совместим с OpenAI: data.text
  const text = data?.text;
  if (!text) {
    throw new Error('VibeCode не вернул поле text');
  }
  return { text, raw: data };
}

