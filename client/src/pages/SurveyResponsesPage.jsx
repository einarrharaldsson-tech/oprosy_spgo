import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, downloadAuthenticated } from '../api';
import ResponseAudio from '../components/ResponseAudio';
import { formatOptionAnswer } from '../lib/options';

function answerText(q, itemAnswers) {
  const ans = itemAnswers.filter((a) => a.questionId === q.id);
  if (q.answerType === 'text' || q.answerType === 'address') return ans[0]?.textValue || '—';
  const texts = ans
    .map((a) => formatOptionAnswer(a.optionText, a.textValue))
    .filter(Boolean);
  return texts.length ? texts.join(', ') : '—';
}

export default function SurveyResponsesPage() {
  const { id } = useParams();
  const [survey, setSurvey] = useState(null);
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [openIds, setOpenIds] = useState(() => new Set());
  const [csvBusy, setCsvBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [s, r] = await Promise.all([
          api(`/surveys/${id}`),
          api(`/surveys/${id}/responses`),
        ]);
        if (!alive) return;
        setSurvey(s);
        setItems(r.items || []);
        setOpenIds(new Set());
      } catch (err) {
        if (alive) setError(err.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  const allOpen = useMemo(
    () => items.length > 0 && openIds.size === items.length,
    [items, openIds]
  );

  const toggleOne = (itemId) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const expandAll = () => setOpenIds(new Set(items.map((i) => i.id)));
  const collapseAll = () => setOpenIds(new Set());

  const downloadCsv = async () => {
    setError('');
    setCsvBusy(true);
    try {
      await downloadAuthenticated(`/surveys/${id}/responses/export.csv`);
    } catch (err) {
      setError(err.message);
    } finally {
      setCsvBusy(false);
    }
  };

  if (loading) return <div className="loading">Загрузка…</div>;

  return (
    <div>
      <p className="muted" style={{ marginBottom: 8 }}>
        <Link to="/">← К опросам</Link>
        {' · '}
        <Link to={`/admin/constructor/${id}`}>Конструктор</Link>
      </p>
      <h1 className="page-title">Результаты</h1>
      <p className="page-sub">
        {survey?.title || 'Опрос'} — {items.length} проведений
      </p>

      {error && <div className="alert" style={{ marginBottom: 12 }}>{error}</div>}

      {!items.length ? (
        <div className="empty">Пока нет сохранённых проведений</div>
      ) : (
        <>
          <div className="row" style={{ marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ minHeight: 36, padding: '0 12px' }}
              onClick={allOpen ? collapseAll : expandAll}
            >
              {allOpen ? 'Свернуть все' : 'Развернуть все'}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              style={{ minHeight: 36, padding: '0 12px' }}
              onClick={downloadCsv}
              disabled={csvBusy}
            >
              {csvBusy ? 'Формирование…' : 'Скачать CSV'}
            </button>
          </div>

          <div className="stack">
            {items.map((item) => {
              const open = openIds.has(item.id);
              const meta = [
                item.conductorName,
                item.respondentNote,
                item.hasAudio ? 'есть аудио' : 'без аудио',
              ]
                .filter(Boolean)
                .join(' · ');

              return (
                <article key={item.id} className={`panel response-card ${open ? 'is-open' : ''}`}>
                  <button
                    type="button"
                    className="response-card-toggle"
                    aria-expanded={open}
                    onClick={() => toggleOne(item.id)}
                  >
                    <span className="response-card-chevron" aria-hidden>
                      {open ? '▼' : '▶'}
                    </span>
                    <span className="response-card-head">
                      <strong>
                        Проведение #{item.sessionNumber}
                        <span className="muted" style={{ fontWeight: 500 }}>
                          {' '}
                          · ID {item.id}
                        </span>
                      </strong>
                      <span className="muted response-card-meta">
                        {new Date(item.createdAt).toLocaleString('ru-RU')}
                        {meta ? ` · ${meta}` : ''}
                      </span>
                    </span>
                  </button>

                  {open && (
                    <div className="response-card-body">
                      {item.hasAudio ? (
                        <ResponseAudio
                          surveyId={id}
                          responseId={item.id}
                          audioDurationSec={item.audioDurationSec}
                          audioSize={item.audioSize}
                        />
                      ) : (
                        <p className="muted" style={{ marginBottom: 12 }}>
                          Аудиозапись отсутствует
                        </p>
                      )}

                      <div className="stack" style={{ marginTop: 12 }}>
                        {(survey?.questions || []).map((q) => (
                          <div key={q.id}>
                            <div style={{ fontWeight: 650 }}>{q.text}</div>
                            <div className="muted">{answerText(q, item.answers)}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
