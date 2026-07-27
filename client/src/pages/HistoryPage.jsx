import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';

export default function HistoryPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await api('/surveys?archived=1');
        if (alive) setItems(data);
      } catch (err) {
        if (alive) setError(err.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const restore = async (id) => {
    setError('');
    setBusyId(id);
    try {
      await api(`/surveys/${id}/status`, { method: 'PATCH', body: { status: 'active' } });
      setItems((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (s) => {
    const ok = confirm(
      `Удалить опрос «${s.title}» безвозвратно?\n\nБудут удалены все проведения, ответы и аудиозаписи.`
    );
    if (!ok) return;
    setError('');
    setBusyId(s.id);
    try {
      await api(`/surveys/${s.id}`, { method: 'DELETE' });
      setItems((prev) => prev.filter((x) => x.id !== s.id));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const copySurvey = async (id) => {
    setError('');
    setBusyId(id);
    try {
      const copy = await api(`/surveys/${id}/copy`, { method: 'POST' });
      navigate(`/admin/constructor/${copy.id}`);
    } catch (err) {
      setError(err.message);
      setBusyId(null);
    }
  };

  if (loading) return <div className="loading">Загрузка истории…</div>;

  return (
    <div>
      <h1 className="page-title">История</h1>
      <p className="page-sub">Архивные опросы видны только администраторам. Удаление архива — здесь; черновики удаляются в конструкторе.</p>

      {error && <div className="alert" style={{ marginBottom: 16 }}>{error}</div>}

      {!items.length ? (
        <div className="empty">Архив пуст</div>
      ) : (
        <div className="stack">
          {items.map((s) => (
            <div key={s.id} className="panel">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h3 style={{ margin: 0 }}>{s.title}</h3>
                <span className="badge badge-archived">Архив</span>
              </div>
              {s.description && <p className="muted">{s.description}</p>}
              <p className="muted" style={{ fontSize: '0.85rem' }}>
                Ответов: {s.responseCount}
                {s.archivedAt && ` · архивирован ${new Date(s.archivedAt).toLocaleString('ru-RU')}`}
              </p>
              <div className="row" style={{ marginTop: 10, flexWrap: 'wrap', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => navigate(`/admin/surveys/${s.id}/responses`)}
                  disabled={busyId === s.id}
                >
                  Результаты
                </button>
                <Link to={`/admin/constructor/${s.id}`} className="btn btn-ghost">
                  Открыть
                </Link>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => copySurvey(s.id)}
                  disabled={busyId === s.id}
                >
                  Копировать опрос
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => restore(s.id)}
                  disabled={busyId === s.id}
                >
                  Вернуть в активные
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => remove(s)}
                  disabled={busyId === s.id}
                >
                  {busyId === s.id ? 'Удаление…' : 'Удалить'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
