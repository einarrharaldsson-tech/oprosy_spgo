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

export default function ResponseAudio({ surveyId, responseId, audioDurationSec, audioSize }) {
  const [src, setSrc] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
    </div>
  );
}
