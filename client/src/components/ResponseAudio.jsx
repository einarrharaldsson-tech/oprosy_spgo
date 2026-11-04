import { useEffect, useState } from 'react';
import { getToken } from '../api';
import { getApiBase } from '../lib/paths';

function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function formatDuration(sec) {
  if (!sec) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function extFromMime(mime) {
  if (!mime) return 'webm';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a';
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('webm')) return 'webm';
  return 'webm';
}

export default function ResponseAudio({ surveyId, responseId, audioDurationSec, audioSize }) {
  const [src, setSrc] = useState('');
  const [mime, setMime] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Транскрибация / DOC временно отключены
  // const [transcribeBusy, setTranscribeBusy] = useState(false);
  // const [transcribeError, setTranscribeError] = useState('');

  useEffect(() => {
    let objectUrl = '';
    let alive = true;

    (async () => {
      setLoading(true);
      setError('');
      try {
        const token = getToken();
        const res = await fetch(`${getApiBase()}/surveys/${surveyId}/responses/${responseId}/audio`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error('Не удалось загрузить запись');
        const blob = await res.blob();
        if (!alive) return;
        setMime(blob.type || res.headers.get('Content-Type') || '');
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      } catch (err) {
        if (alive) setError(err.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [surveyId, responseId]);

  if (loading) return <p className="muted">Загрузка записи…</p>;
  if (error) return <p className="alert" style={{ marginTop: 8 }}>{error}</p>;
  if (!src) return null;

  /*
  const downloadTranscriptionDoc = async () => {
    setTranscribeError('');
    setTranscribeBusy(true);
    try {
      const token = getToken();
      const res = await fetch(
        `${getApiBase()}/surveys/${surveyId}/responses/${responseId}/transcribe`,
        {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        }
      );
      if (!res.ok) {
        let msg = 'Не удалось расшифровать аудио';
        try {
          const data = await res.json();
          msg = data?.error || msg;
        } catch {
          // ignore
        }
        throw new Error(msg);
      }

      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') || '';
      const m = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"/i.exec(cd);
      const filename = m
        ? decodeURIComponent(m[1] || m[2])
        : `transcript_${surveyId}_${responseId}.doc`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setTranscribeError(err.message || 'Не удалось сформировать документ');
    } finally {
      setTranscribeBusy(false);
    }
  };
  */

  const downloadAudio = () => {
    const a = document.createElement('a');
    a.href = src;
    a.download = `survey_${surveyId}_response_${responseId}.${extFromMime(mime)}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div className="audio-block">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <strong>Аудиозапись проведения</strong>
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          {formatDuration(audioDurationSec)}
          {audioSize ? ` · ${formatBytes(audioSize)}` : ''}
        </span>
      </div>
      <audio controls preload="metadata" src={src} className="audio-player" />
      <div className="stack" style={{ marginTop: 10 }}>
        <button
          type="button"
          className="btn btn-accent"
          style={{ minHeight: 36, padding: '0 12px', width: 'fit-content' }}
          onClick={downloadAudio}
        >
          Скачать аудио
        </button>
        {/*
        <button
          type="button"
          className="btn btn-accent"
          style={{ minHeight: 36, padding: '0 12px', width: 'fit-content' }}
          onClick={downloadTranscriptionDoc}
          disabled={transcribeBusy}
        >
          {transcribeBusy ? 'Формирование DOC…' : 'Расшифровать и скачать DOC'}
        </button>
        {transcribeError && (
          <p className="alert" style={{ margin: 0 }}>
            {transcribeError}
          </p>
        )}
        */}
      </div>
    </div>
  );
}
