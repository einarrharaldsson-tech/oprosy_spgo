import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getToken } from '../api';
import { getApiBase } from '../lib/paths.js';
import { validateJumpConfiguration } from '../lib/jumpLogic';

const TYPE_LABEL = {
  checkbox: 'Варианты',
  select: 'Список',
  text: 'Текст',
  address: 'Адрес',
};

async function uploadParse(file) {
  const form = new FormData();
  form.append('file', file);
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${getApiBase()}/surveys/import/parse`, {
    method: 'POST',
    headers,
    body: form,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    throw new Error(data?.error || 'Не удалось разобрать файл');
  }
  return data;
}

function blankOption() {
  return { text: '', jumpAction: 'none', jumpToQuestionIndex: null };
}

export default function ImportSurveyPage() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(null);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setBusy(true);
    setDraft(null);
    try {
      const data = await uploadParse(file);
      const sourceIndexByNumber = new Map(
        (data.questions || [])
          .filter((q) => Number.isInteger(q.sourceNumber))
          .map((q, index) => [q.sourceNumber, index])
      );
      setDraft({
        title: data.title || '',
        description: data.description || '',
        questions: (data.questions || []).map((q) => ({
          text: q.text || '',
          answerType: q.answerType || 'checkbox',
          isRequired: q.isRequired !== false,
          allowMultiple: q.allowMultiple !== false,
          options: (q.options || []).map((o) => ({
            text: o.text || '',
            jumpAction: o.jumpAction || 'none',
            jumpToQuestionIndex:
              o.jumpAction === 'jump' && sourceIndexByNumber.has(o.jumpToSourceNumber)
                ? sourceIndexByNumber.get(o.jumpToSourceNumber)
                : null,
          })),
          sourceNumber: q.sourceNumber,
        })),
        warnings: data.warnings || [],
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const updateMeta = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const updateQuestion = (qi, patch) => {
    setDraft((d) => {
      const questions = d.questions.map((q, i) => (i === qi ? { ...q, ...patch } : q));
      return { ...d, questions };
    });
  };

  const updateOption = (qi, oi, text) => {
    setDraft((d) => {
      const questions = d.questions.map((q, i) => {
        if (i !== qi) return q;
        const options = q.options.map((o, j) => (j === oi ? { ...o, text } : o));
        return { ...q, options };
      });
      return { ...d, questions };
    });
  };

  const addOption = (qi) => {
    setDraft((d) => {
      const questions = d.questions.map((q, i) =>
        i === qi ? { ...q, options: [...(q.options || []), blankOption()] } : q
      );
      return { ...d, questions };
    });
  };

  const removeOption = (qi, oi) => {
    setDraft((d) => {
      const questions = d.questions.map((q, i) => {
        if (i !== qi) return q;
        return { ...q, options: q.options.filter((_, j) => j !== oi) };
      });
      return { ...d, questions };
    });
  };

  const moveOption = (qi, oi, dir) => {
    setDraft((d) => {
      const questions = d.questions.map((q, i) => {
        if (i !== qi) return q;
        const options = [...(q.options || [])];
        const j = oi + dir;
        if (j < 0 || j >= options.length) return q;
        [options[oi], options[j]] = [options[j], options[oi]];
        return { ...q, options };
      });
      return { ...d, questions };
    });
  };

  const removeQuestion = (qi) => {
    setDraft((d) => ({
      ...d,
      questions: d.questions.filter((_, i) => i !== qi),
    }));
  };

  const commit = async () => {
    if (!draft) return;
    setError('');
    setBusy(true);
    try {
      const jumpError = validateJumpConfiguration(draft.questions);
      if (jumpError) {
        setError(jumpError);
        return;
      }
      const body = {
        title: draft.title,
        description: draft.description,
        questions: draft.questions.map((q) => ({
          text: q.text,
          answerType: q.answerType,
          isRequired: q.isRequired,
          allowMultiple: q.answerType === 'checkbox' ? q.allowMultiple !== false : true,
          options:
            q.answerType === 'checkbox' || q.answerType === 'select'
              ? q.options.map((opt) => ({
                  text: opt.text,
                  jumpAction: opt.jumpAction || 'none',
                  jumpToQuestionIndex:
                    opt.jumpAction === 'jump' && Number.isInteger(opt.jumpToQuestionIndex)
                      ? opt.jumpToQuestionIndex
                      : null,
                }))
              : [],
        })),
      };
      const survey = await api('/surveys/import/commit', { method: 'POST', body });
      navigate(`/admin/constructor/${survey.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1 className="page-title">Импорт опроса</h1>
      <p className="page-sub">
        Загрузите анкету в формате .docx. Система разберёт нумерованные вопросы и варианты,
        затем можно поправить превью и создать черновик в конструкторе.
      </p>

      {error && <div className="alert" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="panel" style={{ marginBottom: 18 }}>
        <div className="field">
          <label htmlFor="docx">Файл Word (.docx)</label>
          <input
            id="docx"
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            disabled={busy}
            onChange={onFile}
          />
        </div>
        {busy && !draft && <p className="muted">Разбор документа…</p>}
      </div>

      {draft && (
        <div className="stack">
          {!!draft.warnings?.length && (
            <div
              className="alert"
              style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
            >
              <strong>Замечания при разборе</strong>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                {draft.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="panel stack">
            <div className="field">
              <label>Название</label>
              <input
                value={draft.title}
                onChange={(e) => updateMeta({ title: e.target.value })}
                disabled={busy}
              />
            </div>
            <div className="field">
              <label>Описание</label>
              <textarea
                value={draft.description}
                onChange={(e) => updateMeta({ description: e.target.value })}
                disabled={busy}
              />
            </div>
          </div>

          <h2 className="page-title" style={{ fontSize: '1.15rem', marginTop: 8 }}>
            Вопросы ({draft.questions.length})
          </h2>

          {draft.questions.map((q, qi) => (
            <div key={qi} className="panel stack">
              <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                <strong>
                  {q.sourceNumber != null ? `№ ${q.sourceNumber}` : `Вопрос ${qi + 1}`}
                  <span className="muted"> · {TYPE_LABEL[q.answerType] || q.answerType}</span>
                </strong>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ minHeight: 32, padding: '0 10px' }}
                  disabled={busy}
                  onClick={() => removeQuestion(qi)}
                >
                  Убрать
                </button>
              </div>

              <div className="field">
                <label>Текст</label>
                <textarea
                  value={q.text}
                  onChange={(e) => updateQuestion(qi, { text: e.target.value })}
                  disabled={busy}
                />
              </div>

              <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
                <div className="field" style={{ minWidth: 180 }}>
                  <label>Тип</label>
                  <select
                    value={q.answerType}
                    disabled={busy}
                    onChange={(e) => {
                      const answerType = e.target.value;
                      updateQuestion(qi, {
                        answerType,
                        allowMultiple:
                          answerType === 'checkbox' ? q.allowMultiple !== false : true,
                        options:
                          answerType === 'checkbox' || answerType === 'select'
                            ? q.options?.length
                              ? q.options
                              : [blankOption(), blankOption()]
                            : [],
                      });
                    }}
                  >
                    <option value="checkbox">Варианты</option>
                    <option value="select">Выпадающий список</option>
                    <option value="text">Текст</option>
                    <option value="address">Адрес</option>
                  </select>
                </div>
                <label className="checkbox-row" style={{ marginTop: 22 }}>
                  <input
                    type="checkbox"
                    checked={!!q.isRequired}
                    disabled={busy}
                    onChange={(e) => updateQuestion(qi, { isRequired: e.target.checked })}
                  />
                  Обязательный
                </label>
                {q.answerType === 'checkbox' && (
                  <label className="checkbox-row" style={{ marginTop: 22 }}>
                    <input
                      type="checkbox"
                      checked={q.allowMultiple !== false}
                      disabled={busy}
                      onChange={(e) => updateQuestion(qi, { allowMultiple: e.target.checked })}
                    />
                    Несколько вариантов
                  </label>
                )}
              </div>

              {(q.answerType === 'checkbox' || q.answerType === 'select') && (
                <div className="stack">
                  <label className="muted">Варианты</label>
                  {(q.options || []).map((opt, oi) => (
                    <div key={oi} className="stack" style={{ gap: 8 }}>
                      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                        <div className="row" style={{ gap: 4 }}>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{ minHeight: 36, padding: '0 10px' }}
                            disabled={busy || oi === 0}
                            title="Выше"
                            onClick={() => moveOption(qi, oi, -1)}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{ minHeight: 36, padding: '0 10px' }}
                            disabled={busy || oi === (q.options?.length || 0) - 1}
                            title="Ниже"
                            onClick={() => moveOption(qi, oi, 1)}
                          >
                            ↓
                          </button>
                        </div>
                        <input
                          style={{ flex: 1, minWidth: 160 }}
                          value={opt.text}
                          disabled={busy}
                          onChange={(e) => updateOption(qi, oi, e.target.value)}
                        />
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ minHeight: 36, padding: '0 10px' }}
                          disabled={busy}
                          onClick={() => removeOption(qi, oi)}
                        >
                          ×
                        </button>
                      </div>
                      <div className="field" style={{ maxWidth: 420 }}>
                        <label>Переход после выбора</label>
                        <select
                          value={
                            opt.jumpAction === 'end'
                              ? 'end'
                              : opt.jumpAction === 'jump' && Number.isInteger(opt.jumpToQuestionIndex)
                                ? `jump:${opt.jumpToQuestionIndex}`
                                : 'none'
                          }
                          disabled={busy}
                          onChange={(e) => {
                            const value = e.target.value;
                            if (value === 'none') {
                              updateQuestion(qi, {
                                options: q.options.map((item, j) =>
                                  j === oi
                                    ? { ...item, jumpAction: 'none', jumpToQuestionIndex: null }
                                    : item
                                ),
                              });
                              return;
                            }
                            if (value === 'end') {
                              updateQuestion(qi, {
                                options: q.options.map((item, j) =>
                                  j === oi
                                    ? { ...item, jumpAction: 'end', jumpToQuestionIndex: null }
                                    : item
                                ),
                              });
                              return;
                            }
                            const targetIndex = Number(value.replace('jump:', ''));
                            updateQuestion(qi, {
                              options: q.options.map((item, j) =>
                                j === oi
                                  ? { ...item, jumpAction: 'jump', jumpToQuestionIndex: targetIndex }
                                  : item
                              ),
                            });
                          }}
                        >
                          <option value="none">Без перехода</option>
                          <option value="end">Завершить интервью</option>
                          {draft.questions.slice(qi + 1).map((target, offset) => (
                            <option
                              key={`${qi}-${oi}-${offset}`}
                              value={`jump:${qi + 1 + offset}`}
                            >
                              {`Перейти к вопросу ${
                                target.sourceNumber ?? qi + 2 + offset
                              }. ${target.text}`}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                  {q.answerType === 'checkbox' && (
                    <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>
                      Вариант, начинающийся с «Другое», при проведении откроет поле для своего
                      текста.
                    </p>
                  )}
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ alignSelf: 'flex-start' }}
                      disabled={busy}
                      onClick={() => addOption(qi)}
                    >
                      + Вариант
                    </button>
                    {q.answerType === 'checkbox' && (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ alignSelf: 'flex-start' }}
                        disabled={busy}
                        onClick={() =>
                          updateQuestion(qi, {
                            options: [
                              ...(q.options || []),
                              {
                                text: 'Другое (укажите)',
                                jumpAction: 'none',
                                jumpToQuestionIndex: null,
                              },
                            ],
                          })
                        }
                      >
                        + Другое
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}

          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !draft.questions.length}
              onClick={commit}
            >
              {busy ? 'Создание…' : 'Создать черновик'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => setDraft(null)}
            >
              Сбросить
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
