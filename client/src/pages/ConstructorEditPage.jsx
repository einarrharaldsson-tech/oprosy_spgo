import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { validateJumpConfiguration } from '../lib/jumpLogic';

function blankQuestion() {
  return {
    text: '',
    answerType: 'checkbox',
    isRequired: true,
    allowMultiple: true,
    options: [
      { text: '', jumpAction: 'none', jumpToQuestionIndex: null },
      { text: '', jumpAction: 'none', jumpToQuestionIndex: null },
    ],
  };
}

export default function ConstructorEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [survey, setSurvey] = useState(null);
  const [assignable, setAssignable] = useState([]);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [structureLocked, setStructureLocked] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [data, users] = await Promise.all([
          api(`/surveys/${id}`),
          api('/surveys/meta/assignable-users'),
        ]);
        if (!alive) return;
        setSurvey({
          ...data,
          questions: data.questions?.length ? data.questions : [blankQuestion()],
          accessUserIds: data.accessUserIds || [],
        });
        setAssignable(users);
        setStructureLocked((data.responseCount || 0) > 0);
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

  const update = (patch) => setSurvey((s) => ({ ...s, ...patch }));

  const updateQuestion = (index, patch) => {
    setSurvey((s) => {
      const questions = s.questions.map((q, i) => (i === index ? { ...q, ...patch } : q));
      return { ...s, questions };
    });
  };

  const updateOption = (qi, oi, text) => {
    setSurvey((s) => {
      const questions = s.questions.map((q, i) => {
        if (i !== qi) return q;
        const options = q.options.map((o, j) => (j === oi ? { ...o, text } : o));
        return { ...q, options };
      });
      return { ...s, questions };
    });
  };

  const moveOption = (qi, oi, dir) => {
    setSurvey((s) => {
      const questions = s.questions.map((q, i) => {
        if (i !== qi) return q;
        const options = [...(q.options || [])];
        const j = oi + dir;
        if (j < 0 || j >= options.length) return q;
        [options[oi], options[j]] = [options[j], options[oi]];
        return { ...q, options };
      });
      return { ...s, questions };
    });
  };

  const save = async (statusOverride) => {
    setError('');
    setOk('');
    setBusy(true);
    try {
      const jumpError = validateJumpConfiguration(survey.questions);
      if (jumpError) {
        setError(jumpError);
        return;
      }
      const body = {
        title: survey.title,
        description: survey.description,
        status: statusOverride || survey.status,
        conductMode: survey.conductMode === 'step' ? 'step' : 'scroll',
        accessUserIds: survey.accessUserIds,
        questions: survey.questions.map((q) => ({
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
      const saved = await api(`/surveys/${id}`, { method: 'PUT', body });
      setSurvey({
        ...saved,
        questions: saved.questions?.length ? saved.questions : [blankQuestion()],
      });
      setStructureLocked((saved.responseCount || 0) > 0);
      setOk(
        (saved.responseCount || 0) > 0
          ? 'Сохранено (вопросы заблокированы — уже есть ответы)'
          : 'Опрос сохранён'
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const removeDraft = async () => {
    if (!survey || survey.status !== 'draft') return;
    const okConfirm = confirm(`Удалить черновик «${survey.title}» безвозвратно?`);
    if (!okConfirm) return;
    setError('');
    setBusy(true);
    try {
      await api(`/surveys/${id}`, { method: 'DELETE' });
      navigate('/admin/constructor');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const toggleAccess = (userId) => {
    setSurvey((s) => {
      const set = new Set(s.accessUserIds);
      if (set.has(userId)) set.delete(userId);
      else set.add(userId);
      return { ...s, accessUserIds: [...set] };
    });
  };

  if (loading) return <div className="loading">Загрузка…</div>;
  if (!survey) {
    return (
      <div>
        <div className="alert">{error || 'Не найден'}</div>
        <Link to="/admin/constructor">← Назад</Link>
      </div>
    );
  }

  const locked =
    structureLocked || survey.status === 'archived' || survey.status === 'completed';
  const metaFrozen = survey.status === 'archived' || survey.status === 'completed';
  const statusFrozen = survey.status === 'archived' && user.role !== 'admin';

  return (
    <div>
      <p className="muted" style={{ marginBottom: 8 }}>
        <Link to="/admin/constructor">← К списку конструктора</Link>
      </p>
      <h1 className="page-title">Редактирование</h1>
      <p className="page-sub">Настройте вопросы и доступ сотрудников с ролью «Пользователь».</p>

      {error && <div className="alert" style={{ marginBottom: 12 }}>{error}</div>}
      {ok && <div className="alert alert-ok" style={{ marginBottom: 12 }}>{ok}</div>}
      {structureLocked && (
        <div
          className="alert"
          style={{ marginBottom: 12, background: 'var(--accent-soft)', color: 'var(--accent)' }}
        >
          По опросу уже есть ответы — менять состав вопросов нельзя. Можно обновить название, режим
          проведения, доступ и статус.
        </div>
      )}

      <div className="stack">
        <div className="panel stack">
          <div className="field">
            <label>Название</label>
            <input
              value={survey.title}
              onChange={(e) => update({ title: e.target.value })}
              disabled={metaFrozen}
            />
          </div>
          <div className="field">
            <label>Описание</label>
            <textarea
              value={survey.description || ''}
              onChange={(e) => update({ description: e.target.value })}
              disabled={metaFrozen}
            />
          </div>
          <div className="field">
            <label>Статус</label>
            <select
              value={survey.status}
              onChange={(e) => update({ status: e.target.value })}
              disabled={statusFrozen}
            >
              <option value="draft">Черновик</option>
              <option value="active">Активен (доступен для проведения)</option>
              <option value="completed">Завершён</option>
              {user.role === 'admin' && <option value="archived">Архив</option>}
            </select>
          </div>
          <div className="field">
            <label>Режим проведения</label>
            <select
              value={survey.conductMode === 'step' ? 'step' : 'scroll'}
              onChange={(e) => update({ conductMode: e.target.value })}
              disabled={metaFrozen}
            >
              <option value="scroll">Список — все вопросы на одной странице</option>
              <option value="step">По одному — следующий вопрос по стрелкам</option>
            </select>
            <p className="muted" style={{ fontSize: '0.85rem', margin: '6px 0 0' }}>
              Режим задаётся здесь и не меняется сотрудником во время опроса.
            </p>
          </div>
        </div>

        <div className="panel stack">
          <h3 style={{ margin: 0 }}>Вопросы</h3>
          {survey.questions.map((q, qi) => (
            <div key={qi} className="constructor-q stack">
              <div className="field">
                <label>Вопрос {qi + 1}</label>
                <input
                  value={q.text}
                  onChange={(e) => updateQuestion(qi, { text: e.target.value })}
                  disabled={locked}
                  placeholder="Текст вопроса"
                />
              </div>
              <div className="row">
                <div className="field" style={{ flex: 1, minWidth: 160 }}>
                  <label>Тип ответа</label>
                  <select
                    value={q.answerType}
                    disabled={locked}
                    onChange={(e) => {
                      const answerType = e.target.value;
                      const needsOptions =
                        answerType === 'checkbox' || answerType === 'select';
                      updateQuestion(qi, {
                        answerType,
                        allowMultiple:
                          answerType === 'checkbox' ? q.allowMultiple !== false : true,
                        options: needsOptions
                          ? q.options?.length
                            ? q.options
                            : [
                                { text: '', jumpAction: 'none', jumpToQuestionIndex: null },
                                { text: '', jumpAction: 'none', jumpToQuestionIndex: null },
                              ]
                          : [],
                      });
                    }}
                  >
                    <option value="checkbox">Варианты (галочки / один выбор)</option>
                    <option value="select">Выпадающий список (один вариант)</option>
                    <option value="text">Текстовое поле</option>
                    <option value="address">Адрес (подсказки DaData)</option>
                  </select>
                </div>
                <label className="checkbox-row" style={{ marginTop: 22 }}>
                  <input
                    type="checkbox"
                    checked={!!q.isRequired}
                    disabled={locked}
                    onChange={(e) => updateQuestion(qi, { isRequired: e.target.checked })}
                  />
                  Обязательный
                </label>
              </div>

              {q.answerType === 'checkbox' && (
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={q.allowMultiple !== false}
                    disabled={locked}
                    onChange={(e) => updateQuestion(qi, { allowMultiple: e.target.checked })}
                  />
                  <span>Можно отметить несколько вариантов</span>
                </label>
              )}

              {(q.answerType === 'checkbox' || q.answerType === 'select') && (
                <div className="stack">
                  <label className="muted">
                    {q.answerType === 'select'
                      ? 'Варианты списка'
                      : q.allowMultiple === false
                        ? 'Варианты (выбор одного)'
                        : 'Варианты (можно несколько)'}
                  </label>
                  {(q.options || []).map((opt, oi) => (
                    <div key={oi} className="stack" style={{ gap: 8 }}>
                      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                      {!locked && (
                        <div className="row" style={{ gap: 4 }}>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{ minHeight: 36, padding: '0 10px' }}
                            disabled={oi === 0}
                            title="Выше"
                            onClick={() => moveOption(qi, oi, -1)}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{ minHeight: 36, padding: '0 10px' }}
                            disabled={oi === (q.options?.length || 0) - 1}
                            title="Ниже"
                            onClick={() => moveOption(qi, oi, 1)}
                          >
                            ↓
                          </button>
                        </div>
                      )}
                      <input
                        style={{ flex: 1, minWidth: 160 }}
                        value={opt.text}
                        disabled={locked}
                        onChange={(e) => updateOption(qi, oi, e.target.value)}
                        placeholder={`Вариант ${oi + 1}`}
                      />
                      {!locked && (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() =>
                            updateQuestion(qi, {
                              options: q.options.filter((_, j) => j !== oi),
                            })
                          }
                        >
                          Удалить
                        </button>
                      )}
                      </div>
                      <div className="field" style={{ maxWidth: 420, marginLeft: locked ? 0 : 88 }}>
                        <label>Переход после выбора</label>
                        <select
                          value={
                            opt.jumpAction === 'end'
                              ? 'end'
                              : opt.jumpAction === 'jump' && Number.isInteger(opt.jumpToQuestionIndex)
                                ? `jump:${opt.jumpToQuestionIndex}`
                                : 'none'
                          }
                          disabled={locked}
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
                          {survey.questions.slice(qi + 1).map((target, offset) => (
                            <option key={target.id || `${qi}-${oi}-${offset}`} value={`jump:${qi + 1 + offset}`}>
                              {`Перейти к вопросу ${qi + 2 + offset}. ${target.text}`}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                  {q.answerType === 'checkbox' && !locked && (
                    <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>
                      Вариант, начинающийся с «Другое», при проведении откроет поле для своего
                      текста.
                    </p>
                  )}
                  {!locked && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() =>
                        updateQuestion(qi, {
                          options: [
                            ...(q.options || []),
                            { text: '', jumpAction: 'none', jumpToQuestionIndex: null },
                          ],
                        })
                      }
                    >
                      + Вариант
                    </button>
                  )}
                  {!locked && q.answerType === 'checkbox' && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() =>
                        updateQuestion(qi, {
                          options: [
                            ...(q.options || []),
                            { text: 'Другое (укажите)', jumpAction: 'none', jumpToQuestionIndex: null },
                          ],
                        })
                      }
                    >
                      + Другое
                    </button>
                  )}
                </div>
              )}

              {!locked && (
                <div className="tools">
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() =>
                      setSurvey((s) => ({
                        ...s,
                        questions: s.questions.filter((_, i) => i !== qi),
                      }))
                    }
                  >
                    Удалить вопрос
                  </button>
                </div>
              )}
            </div>
          ))}

          {!locked && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() =>
                setSurvey((s) => ({ ...s, questions: [...s.questions, blankQuestion()] }))
              }
            >
              + Добавить вопрос
            </button>
          )}
        </div>

        <div className="panel stack">
          <h3 style={{ margin: 0 }}>Доступ пользователей</h3>
          <p className="muted" style={{ margin: 0 }}>
            Кому из сотрудников с ролью «Пользователь» виден этот опрос.
          </p>
          {!assignable.length ? (
            <p className="muted">Нет активных пользователей с ролью «Пользователь».</p>
          ) : (
            assignable.map((u) => (
              <label key={u.id} className="checkbox-row">
                <input
                  type="checkbox"
                  checked={survey.accessUserIds.includes(u.id)}
                  onChange={() => toggleAccess(u.id)}
                  disabled={metaFrozen}
                />
                {u.fullName || u.login} <span className="muted">({u.login})</span>
              </label>
            ))
          )}
        </div>

        <div className="row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || (survey.status === 'archived' && user.role !== 'admin')}
            onClick={() => save()}
          >
            {busy ? 'Сохранение…' : 'Сохранить'}
          </button>
          {survey.status !== 'active' &&
            survey.status !== 'archived' &&
            survey.status !== 'completed' && (
            <button
              type="button"
              className="btn btn-accent"
              disabled={busy}
              onClick={() => save('active')}
            >
              Сохранить и активировать
            </button>
          )}
          <Link to={`/admin/surveys/${id}/responses`} className="btn btn-ghost">
            Результаты
          </Link>
          {survey.status === 'draft' && (
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              onClick={removeDraft}
            >
              Удалить черновик
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
