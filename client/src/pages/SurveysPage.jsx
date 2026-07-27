import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';

const STATUS = {
  active: { label: 'Активен', className: 'badge-active' },
  draft: { label: 'Черновик', className: 'badge-draft' },
  completed: { label: 'Завершён', className: 'badge-completed' },
  archived: { label: 'Архив', className: 'badge-archived' },
};

export default function SurveysPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const canManage = user.role === 'admin' || user.role === 'editor';
  const isAdmin = user.role === 'admin';
  const isEditor = user.role === 'editor';

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await api('/surveys');
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

  const setStatus = async (id, status, confirmMsg, e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(confirmMsg)) return;
    try {
      await api(`/surveys/${id}/status`, { method: 'PATCH', body: { status } });
      setItems((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) return <div className="loading">Загрузка опросов…</div>;

  return (
    <div>
      <h1 className="page-title">Опросы</h1>
      <p className="page-sub">
        {user.role === 'user'
          ? 'Выберите опрос, к которому вам открыт доступ, и начните проведение.'
          : 'Выберите опрос для проведения. Черновики доступны только в конструкторе.'}
      </p>

      {error && <div className="alert" style={{ marginBottom: 16 }}>{error}</div>}

      {!items.length ? (
        <div className="empty">Нет доступных опросов</div>
      ) : (
        <div className="stack">
          {items
            .filter((s) => user.role === 'user' || s.status === 'active')
            .map((s) => {
              const st = STATUS[s.status] || STATUS.draft;
              return (
                <div key={s.id} className="survey-item" role="button" tabIndex={0}
                  onClick={() => navigate(`/survey/${s.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      navigate(`/survey/${s.id}`);
                    }
                  }}
                >
                  <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                    <h3>{s.title}</h3>
                    <span className={`badge ${st.className}`}>{st.label}</span>
                  </div>
                  {s.description && <p>{s.description}</p>}
                  <div className="row" style={{ marginTop: 12 }}>
                    <span className="muted" style={{ fontSize: '0.85rem' }}>
                      Ответов: {s.responseCount}
                    </span>
                    {canManage && (
                      <Link
                        to={`/admin/surveys/${s.id}/responses`}
                        className="btn btn-ghost"
                        style={{ minHeight: 36, padding: '0 12px' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        Результаты
                      </Link>
                    )}
                    {(isEditor || isAdmin) && s.status === 'active' && (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ minHeight: 36, padding: '0 12px' }}
                        onClick={(e) =>
                          setStatus(
                            s.id,
                            'completed',
                            'Перенести опрос в «Завершённые»?',
                            e
                          )
                        }
                      >
                        В завершённые
                      </button>
                    )}
                    {isAdmin && s.status === 'active' && (
                      <button
                        type="button"
                        className="btn btn-danger"
                        style={{ minHeight: 36, padding: '0 12px' }}
                        onClick={(e) =>
                          setStatus(s.id, 'archived', 'Перенести опрос в архив (История)?', e)
                        }
                      >
                        В архив
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {canManage && items.some((s) => s.status === 'draft') && (
        <p className="muted" style={{ marginTop: 18 }}>
          Есть черновики — откройте их в{' '}
          <Link to="/admin/constructor">конструкторе</Link>.
        </p>
      )}
    </div>
  );
}
