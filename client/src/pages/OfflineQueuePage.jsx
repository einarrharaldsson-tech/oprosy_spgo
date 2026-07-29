import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { appendOfflineLog, clearOfflineLog, getOfflineLogItems } from '../lib/offlineConductLog';
import { syncAllPendingConductSessions, syncPendingConductSession } from '../lib/offlineConductSync';
import {
  deleteConductSession,
  listPendingConductSessions,
} from '../lib/offlineConductStore';

function statusLabel(session) {
  if (session.status === 'active') return 'Черновик на устройстве';
  if (session.status === 'uploading') return 'Идёт догрузка';
  if (session.status === 'failed') return 'Ошибка отправки';
  return 'Ожидает отправки';
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('ru-RU');
}

export default function OfflineQueuePage() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [logItems, setLogItems] = useState([]);

  const refresh = async () => {
    setItems(await listPendingConductSessions());
    setLogItems(getOfflineLogItems());
  };

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
  }, []);

  const retryOne = async (item) => {
    setBusyId(item.localSessionId);
    setError('');
    setMessage('');
    try {
      await syncPendingConductSession(item);
      appendOfflineLog('Ручной повтор отправки завершён успешно', {
        localSessionId: item.localSessionId,
      });
      setMessage('Проведение успешно догружено на сервер.');
      await refresh();
    } catch (err) {
      appendOfflineLog('Ручной повтор отправки завершился ошибкой', {
        localSessionId: item.localSessionId,
        error: err.message || 'Неизвестная ошибка',
      });
      setError(err.message || 'Не удалось догрузить проведение');
      await refresh();
    } finally {
      setBusyId('');
    }
  };

  const retryAll = async () => {
    setBusyId('all');
    setError('');
    setMessage('');
    try {
      const results = await syncAllPendingConductSessions();
      const uploaded = results.filter((item) => item?.uploaded).length;
      appendOfflineLog('Запущена массовая догрузка очереди', { uploaded });
      setMessage(
        uploaded > 0
          ? `Успешно догружено проведений: ${uploaded}.`
          : 'Новых успешных отправок пока нет.'
      );
      await refresh();
    } catch (err) {
      setError(err.message || 'Не удалось запустить массовую догрузку');
    } finally {
      setBusyId('');
    }
  };

  const removeItem = async (item) => {
    const ok = confirm(
      'Удалить локально сохранённое проведение? Это действие нельзя отменить.'
    );
    if (!ok) return;
    setBusyId(item.localSessionId);
    setError('');
    try {
      await deleteConductSession(item.localSessionId);
      appendOfflineLog('Локально сохранённое проведение удалено с устройства', {
        localSessionId: item.localSessionId,
      });
      await refresh();
    } catch (err) {
      setError(err.message || 'Не удалось удалить локальное проведение');
    } finally {
      setBusyId('');
    }
  };

  return (
    <div>
      <h1 className="page-title">Очередь догрузки</h1>
      <p className="page-sub">
        Здесь видны проведения, которые сохранены на устройстве и ещё не полностью ушли на сервер.
      </p>

      {error && <div className="alert" style={{ marginBottom: 12 }}>{error}</div>}
      {message && <div className="alert alert-ok" style={{ marginBottom: 12 }}>{message}</div>}

      <div className="row" style={{ marginBottom: 12 }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busyId === 'all' || !items.length}
          onClick={retryAll}
        >
          {busyId === 'all' ? 'Догрузка…' : 'Догрузить всё'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => refresh()}>
          Обновить
        </button>
      </div>

      {!items.length ? (
        <div className="empty">Нет локально сохранённых проведений</div>
      ) : (
        <div className="stack">
          {items.map((item) => (
            <div key={item.localSessionId} className="panel stack">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>{item.surveyTitle || `Опрос #${item.surveyId}`}</strong>
                <span className="badge badge-draft">{statusLabel(item)}</span>
              </div>

              <p className="muted" style={{ margin: 0 }}>
                Сохранено: {formatDate(item.updatedAt || item.createdAt)}
              </p>
              <p className="muted" style={{ margin: 0 }}>
                Аудиофрагментов: {Number(item.totalChunks) || 0}
                {item.retryCount ? ` · Повторов: ${item.retryCount}` : ''}
              </p>
              {item.lastError && (
                <p className="muted" style={{ margin: 0 }}>
                  Последняя ошибка: {item.lastError}
                </p>
              )}

              <div className="row">
                {item.status === 'active' ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busyId === item.localSessionId}
                    onClick={() => navigate(`/survey/${item.surveyId}`)}
                  >
                    Продолжить опрос
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busyId === item.localSessionId}
                    onClick={() => retryOne(item)}
                  >
                    {busyId === item.localSessionId ? 'Отправка…' : 'Повторить отправку'}
                  </button>
                )}

                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={busyId === item.localSessionId}
                  onClick={() => removeItem(item)}
                >
                  Удалить с устройства
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="muted" style={{ marginTop: 16 }}>
        <Link to="/">← К списку опросов</Link>
      </p>

      <div className="panel stack" style={{ marginTop: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <strong>Диагностический лог</strong>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ minHeight: 34, padding: '0 10px' }}
            onClick={() => {
              clearOfflineLog();
              setLogItems([]);
            }}
          >
            Очистить
          </button>
        </div>
        {!logItems.length ? (
          <p className="muted" style={{ margin: 0 }}>
            Лог пока пуст.
          </p>
        ) : (
          <div className="offline-log">
            {logItems.map((item) => (
              <div key={item.id} className="offline-log__item">
                <div className="offline-log__time">{formatDate(item.at)}</div>
                <div>{item.message}</div>
                {item.meta?.error && (
                  <div className="muted" style={{ fontSize: '0.82rem' }}>
                    {item.meta.error}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
