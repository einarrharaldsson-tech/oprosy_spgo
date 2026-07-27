import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';

const STATUS = {
  active: { label: 'Активен', className: 'badge-active' },
  draft: { label: 'Черновик', className: 'badge-draft' },
  completed: { label: 'Завершён', className: 'badge-completed' },
  archived: { label: 'Архив', className: 'badge-archived' },
};

export default function ConstructorListPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    const data = await api('/surveys');
    setItems(data);
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await load();
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

  const create = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const survey = await api('/surveys', {
        method: 'POST',
        body: { title: title.trim() || 'Новый опрос' },
      });
      navigate(`/admin/constructor/${survey.id}`);
    } catch (err) {
      setError(err.message);
    }
  };

  const removeDraft = async (s, e) => {
    e.preventDefault();
    e.stopPropagation();
    const ok = confirm(`Удалить черновик «${s.title}» безвозвратно?`);
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

  const copySurvey = async (s, e) => {
    e.preventDefault();
    e.stopPropagation();
    setError('');
    setBusyId(s.id);
    try {
      const copy = await api(`/surveys/${s.id}/copy`, { method: 'POST' });
      navigate(`/admin/constructor/${copy.id}`);
    } catch (err) {
      setError(err.message);
      setBusyId(null);
    }
  };

  if (loading) return <div className="loading">Загрузка…</div>;

  return (
    <div>
      <h1 className="page-title">Конструктор</h1>
      <p className="page-sub">
        Создавайте опросы, вопросы и варианты ответов. Черновики можно копировать и удалять.
      </p>

      {error && <div className="alert" style={{ marginBottom: 12 }}>{error}</div>}

      <form className="panel row" onSubmit={create} style={{ marginBottom: 18 }}>
        <div className="field" style={{ flex: 1, minWidth: 200 }}>
          <label>Название нового опроса</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Например: Оценка сервиса"
          />
        </div>
        <button className="btn btn-primary" type="submit" style={{ alignSelf: 'flex-end' }}>
          Создать
        </button>
      </form>

      {!items.length ? (
        <div className="empty">Пока нет опросов</div>
      ) : (
        <div className="stack">
          {items.map((s) => {
            const st = STATUS[s.status] || STATUS.draft;
            return (
              <div key={s.id} className="survey-item">
                <Link
                  to={`/admin/constructor/${s.id}`}
                  style={{ color: 'inherit', textDecoration: 'none', display: 'block' }}
                >
                  <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                    <h3>{s.title}</h3>
                    <span className={`badge ${st.className}`}>{st.label}</span>
                  </div>
                  {s.description && <p>{s.description}</p>}
                  <p className="muted" style={{ marginTop: 8, fontSize: '0.85rem' }}>
                    Ответов: {s.responseCount}
                  </p>
                </Link>
                {s.status === 'draft' && (
                  <div className="row" style={{ marginTop: 10, flexWrap: 'wrap', gap: 8 }}>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ minHeight: 36, padding: '0 12px' }}
                      disabled={busyId === s.id}
                      onClick={(e) => copySurvey(s, e)}
                    >
                      Копировать опрос
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      style={{ minHeight: 36, padding: '0 12px' }}
                      disabled={busyId === s.id}
                      onClick={(e) => removeDraft(s, e)}
                    >
                      {busyId === s.id ? 'Подождите…' : 'Удалить черновик'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
