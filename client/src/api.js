import { getApiBase } from './lib/paths.js';

const TOKEN_KEY = 'oprosy_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export async function api(path, options = {}) {
  const headers = {
    ...(options.body !== undefined && !(options.body instanceof FormData)
      ? { 'Content-Type': 'application/json' }
      : {}),
    ...(options.headers || {}),
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${getApiBase()}${path}`, {
    ...options,
    headers,
    body:
      options.body === undefined
        ? undefined
        : options.body instanceof FormData
          ? options.body
          : JSON.stringify(options.body),
  });

  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }

  if (!res.ok) {
    const err = new Error(data?.error || 'Ошибка запроса');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/** Download binary/text file (e.g. CSV) with auth header */
export async function downloadAuthenticated(path, filenameHint) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${getApiBase()}${path}`, { headers });
  if (!res.ok) {
    let msg = 'Не удалось скачать файл';
    try {
      const data = await res.json();
      if (data?.error) msg = data.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }

  const blob = await res.blob();
  let filename = filenameHint || 'download.csv';
  const cd = res.headers.get('Content-Disposition') || '';
  const m = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"/i.exec(cd);
  if (m) {
    filename = decodeURIComponent(m[1] || m[2]);
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function submitSurveyResponse(surveyId, { payload, audioBlob, audioDurationSec }) {
  const form = new FormData();
  form.append('payload', JSON.stringify(payload));
  form.append('audioDurationSec', String(audioDurationSec || 0));
  if (audioBlob) {
    const ext = audioBlob.type?.includes('mp4') ? 'm4a' : 'webm';
    form.append('audio', audioBlob, `response.${ext}`);
  }
  return api(`/surveys/${surveyId}/responses`, { method: 'POST', body: form });
}

export async function createResponseUploadSession(
  surveyId,
  { clientSessionId, audioMime, audioDurationSec }
) {
  return api(`/surveys/${surveyId}/responses/session`, {
    method: 'POST',
    body: {
      clientSessionId,
      audioMime: audioMime || null,
      audioDurationSec: audioDurationSec || 0,
    },
  });
}

export async function getResponseUploadSessionStatus(surveyId, uploadSessionId) {
  return api(`/surveys/${surveyId}/responses/session/${uploadSessionId}/status`);
}

export async function uploadResponseAudioChunk(
  surveyId,
  uploadSessionId,
  { chunkIndex, chunkBlob, audioDurationSec }
) {
  const form = new FormData();
  form.append('chunkIndex', String(chunkIndex));
  form.append('audioDurationSec', String(audioDurationSec || 0));
  const ext = chunkBlob.type?.includes('mp4') ? 'm4a' : 'webm';
  form.append('chunk', chunkBlob, `chunk-${chunkIndex}.${ext}`);
  return api(`/surveys/${surveyId}/responses/session/${uploadSessionId}/chunks`, {
    method: 'POST',
    body: form,
  });
}

export async function finalizeResponseUploadSession(
  surveyId,
  uploadSessionId,
  { payload, totalChunks, hasAudio }
) {
  return api(`/surveys/${surveyId}/responses/session/${uploadSessionId}/finalize`, {
    method: 'POST',
    body: {
      payload,
      totalChunks,
      hasAudio,
    },
  });
}
