import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { submitSurveyResponse, api } from '../api';
import AddressInput from '../components/AddressInput';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import { buildReachableQuestionIds, resolveJumpFromAnswer } from '../lib/jumpLogic';
import { isOtherOptionText } from '../lib/options';

function isTextLike(answerType) {
  return answerType === 'text' || answerType === 'address';
}

function blankChoiceAnswer() {
  return { optionIds: [], otherTexts: {} };
}

function isMultiChoice(question) {
  return question?.answerType === 'checkbox' && question.allowMultiple !== false;
}

function isQuestionAnswered(question, answer) {
  if (!question) return false;
  if (isTextLike(question.answerType)) {
    return Boolean(String(answer?.textValue || '').trim());
  }
  const ids = (answer?.optionIds || []).map(Number);
  if (!ids.length) return false;
  for (const opt of question.options || []) {
    if (!ids.includes(Number(opt.id))) continue;
    if (isOtherOptionText(opt.text)) {
      const text =
        answer?.otherTexts?.[opt.id] ??
        answer?.otherTexts?.[Number(opt.id)] ??
        answer?.otherTexts?.[String(opt.id)];
      if (!String(text || '').trim()) return false;
    }
  }
  return true;
}

export default function ConductPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [survey, setSurvey] = useState(null);
  const [answers, setAnswers] = useState({});
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sessionActive, setSessionActive] = useState(false);
  const [skipAudio, setSkipAudio] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [stepPhase, setStepPhase] = useState('questions');

  const recorder = useVoiceRecorder();
  const questionRefs = useRef({});
  const submitRef = useRef(null);
  const pendingScrollRef = useRef(null);
  const pendingStepRef = useRef(null);

  const isStepMode = survey?.conductMode === 'step';

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await api(`/surveys/${id}`);
        if (!alive) return;
        if (data.status === 'draft') {
          setError('Черновик нельзя проводить. Опубликуйте опрос в конструкторе.');
        }
        setSurvey(data);
        const init = {};
        for (const q of data.questions) {
          init[q.id] = isTextLike(q.answerType) ? { textValue: '' } : blankChoiceAnswer();
        }
        setAnswers(init);
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

  const canSubmit = useMemo(() => {
    if (!survey || survey.status !== 'active' || !sessionActive) return false;
    if (skipAudio) return true;
    return recorder.isRecording;
  }, [survey, sessionActive, skipAudio, recorder.isRecording]);

  const reachableQuestionIds = useMemo(() => {
    if (!survey?.questions?.length) return [];
    return buildReachableQuestionIds(survey.questions, answers);
  }, [survey, answers]);

  const reachableQuestionIdSet = useMemo(
    () => new Set(reachableQuestionIds.map(Number)),
    [reachableQuestionIds]
  );

  const visibleQuestions = useMemo(
    () => (survey?.questions || []).filter((q) => reachableQuestionIdSet.has(Number(q.id))),
    [survey, reachableQuestionIdSet]
  );

  useEffect(() => {
    if (!isStepMode) return;
    const pending = pendingStepRef.current;
    if (pending) {
      pendingStepRef.current = null;
      if (pending === 'end') {
        setStepPhase('submit');
        return;
      }
      const idx = visibleQuestions.findIndex((q) => Number(q.id) === Number(pending));
      if (idx >= 0) {
        setStepPhase('questions');
        setStepIndex(idx);
      }
      return;
    }
    setStepIndex((i) => {
      if (!visibleQuestions.length) return 0;
      return Math.min(i, visibleQuestions.length - 1);
    });
  }, [visibleQuestions, isStepMode]);

  useEffect(() => {
    if (isStepMode) return;
    const pending = pendingScrollRef.current;
    if (!pending || !survey) return;

    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      pendingScrollRef.current = null;
      if (pending.type === 'end') {
        submitRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      const targetId =
        pending.questionId != null
          ? pending.questionId
          : survey.questions[pending.index]?.id;
      if (targetId == null) return;
      questionRefs.current[targetId]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    const frame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(run);
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [visibleQuestions, survey, isStepMode]);

  const resolveNextTarget = (questionId, nextAnswers) => {
    if (!survey?.questions?.length) return null;
    const questionIndex = survey.questions.findIndex((q) => Number(q.id) === Number(questionId));
    if (questionIndex < 0) return null;
    const question = survey.questions[questionIndex];
    const questionIndexById = new Map(
      survey.questions.map((q, index) => [Number(q.id), index])
    );
    const jump = resolveJumpFromAnswer(question, nextAnswers[questionId], questionIndexById);

    if (jump === 'end') return 'end';
    if (Number.isInteger(jump) && survey.questions[jump]) {
      return survey.questions[jump].id;
    }

    const nextReachable = buildReachableQuestionIds(survey.questions, nextAnswers);
    const pos = nextReachable.findIndex((qid) => Number(qid) === Number(questionId));
    return pos >= 0 ? nextReachable[pos + 1] ?? null : null;
  };

  const handleJumpAfterAnswer = (questionId, nextAnswers, { forceAdvance = false } = {}) => {
    const question = survey?.questions?.find((q) => Number(q.id) === Number(questionId));
    if (!question) return;

    // В пошаговом режиме мультивыбор и текст не автопереходим — нужна кнопка «Далее».
    if (isStepMode && !forceAdvance) {
      if (isMultiChoice(question) || isTextLike(question.answerType)) return;
      if (!isQuestionAnswered(question, nextAnswers[questionId])) return;
    }

    const target = resolveNextTarget(questionId, nextAnswers);
    if (target == null) {
      if (isStepMode) pendingStepRef.current = 'end';
      return;
    }

    if (isStepMode) {
      pendingStepRef.current = target;
      return;
    }

    if (target === 'end') {
      pendingScrollRef.current = { type: 'end' };
      return;
    }
    pendingScrollRef.current = { type: 'question', questionId: target };
  };

  const beginSession = async () => {
    setError('');
    setOk('');
    setStepIndex(0);
    setStepPhase('questions');
    if (skipAudio) {
      recorder.reset();
      setSessionActive(true);
      return;
    }
    const started = await recorder.start();
    if (started) setSessionActive(true);
  };

  const resetForNextRespondent = async () => {
    const init = {};
    for (const q of survey.questions) {
      init[q.id] = isTextLike(q.answerType) ? { textValue: '' } : blankChoiceAnswer();
    }
    setAnswers(init);
    setNote('');
    setStepIndex(0);
    setStepPhase('questions');
    recorder.reset();
    setSessionActive(false);
    setOk(
      skipAudio
        ? 'Проведение сохранено. Нажмите «Начать проведение» для следующего респондента.'
        : 'Проведение сохранено. Нажмите «Начать запись» для следующего респондента.'
    );
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const toggleOption = (questionId, optionId) => {
    setAnswers((prev) => {
      const cur = prev[questionId]?.optionIds || [];
      const otherTexts = { ...(prev[questionId]?.otherTexts || {}) };
      const next = cur.includes(optionId)
        ? cur.filter((x) => x !== optionId)
        : [...cur, optionId];
      if (!next.includes(optionId)) delete otherTexts[optionId];
      const nextAnswers = { ...prev, [questionId]: { optionIds: next, otherTexts } };
      handleJumpAfterAnswer(questionId, nextAnswers);
      return nextAnswers;
    });
  };

  const setSingleOption = (questionId, optionId) => {
    setAnswers((prev) => {
      const idNum = optionId ? Number(optionId) : null;
      const prevOther = prev[questionId]?.otherTexts || {};
      const otherTexts = idNum && prevOther[idNum] ? { [idNum]: prevOther[idNum] } : {};
      const nextAnswers = {
        ...prev,
        [questionId]: { optionIds: idNum ? [idNum] : [], otherTexts },
      };
      handleJumpAfterAnswer(questionId, nextAnswers);
      return nextAnswers;
    });
  };

  const setOtherText = (questionId, optionId, text) => {
    setAnswers((prev) => ({
      ...prev,
      [questionId]: {
        optionIds: prev[questionId]?.optionIds || [],
        otherTexts: {
          ...(prev[questionId]?.otherTexts || {}),
          [optionId]: text,
        },
      },
    }));
  };

  const setText = (questionId, textValue) => {
    setAnswers((prev) => ({ ...prev, [questionId]: { textValue } }));
  };

  const setSelect = (questionId, optionId) => {
    setSingleOption(questionId, optionId);
  };

  const goStepPrev = () => {
    if (stepPhase === 'submit') {
      setStepPhase('questions');
      setStepIndex(Math.max(0, visibleQuestions.length - 1));
      return;
    }
    setStepIndex((i) => Math.max(0, i - 1));
  };

  const goStepNext = () => {
    const q = visibleQuestions[stepIndex];
    if (!q) return;
    if (q.isRequired && !isQuestionAnswered(q, answers[q.id])) {
      setError('Ответьте на вопрос, прежде чем продолжить');
      return;
    }
    setError('');
    const target = resolveNextTarget(q.id, answers);
    if (target === 'end' || target == null) {
      setStepPhase('submit');
      return;
    }
    const nextIds = buildReachableQuestionIds(survey.questions, answers).map(Number);
    const idx = nextIds.findIndex((qid) => qid === Number(target));
    if (idx >= 0) {
      setStepPhase('questions');
      setStepIndex(idx);
      return;
    }
    setStepPhase('submit');
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setOk('');
    setBusy(true);
    try {
      let blob = null;
      let durationSec = 0;
      if (!skipAudio) {
        const stopped = await recorder.stop();
        blob = stopped.blob;
        durationSec = stopped.durationSec;
      }
      const payload = {
        respondentNote: note,
        answers: Object.entries(answers)
          .filter(([questionId]) => reachableQuestionIdSet.has(Number(questionId)))
          .map(([questionId, val]) => ({
            questionId: Number(questionId),
            ...val,
          })),
      };
      await submitSurveyResponse(id, {
        payload,
        audioBlob: blob,
        audioDurationSec: durationSec,
      });
      await resetForNextRespondent();
    } catch (err) {
      setError(err.message);
      if (!skipAudio && !recorder.isRecording && sessionActive) {
        await recorder.start();
      }
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="loading">Загрузка опроса…</div>;
  if (!survey) {
    return (
      <div>
        <div className="alert">{error || 'Опрос не найден'}</div>
        <button type="button" className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => navigate('/')}>
          К списку
        </button>
      </div>
    );
  }

  const formDisabled = !sessionActive || (!skipAudio && !recorder.isRecording);
  const currentStepQuestion = visibleQuestions[stepIndex];
  const canGoPrev = stepPhase === 'submit' || stepIndex > 0;
  const isLastReachable =
    stepPhase === 'questions' && stepIndex >= Math.max(0, visibleQuestions.length - 1);

  const renderQuestion = (q) => {
    const idx = survey.questions.findIndex((item) => item.id === q.id);
    return (
      <div
        key={q.id}
        className="question-block"
        ref={(el) => {
          questionRefs.current[q.id] = el;
        }}
      >
        <h3>
          {idx + 1}. {q.text}
          {q.isRequired && <span className="muted"> *</span>}
        </h3>

        {q.answerType === 'text' ? (
          <div className="field">
            <textarea
              value={answers[q.id]?.textValue || ''}
              onChange={(e) => setText(q.id, e.target.value)}
              required={q.isRequired}
              disabled={formDisabled}
              placeholder="Введите ответ"
            />
          </div>
        ) : q.answerType === 'address' ? (
          <div className="field">
            <AddressInput
              value={answers[q.id]?.textValue || ''}
              onChange={(v) => setText(q.id, v)}
              required={q.isRequired}
              disabled={formDisabled}
              placeholder="Город, улица, дом…"
            />
          </div>
        ) : q.answerType === 'select' ? (
          <div className="field">
            <select
              value={(answers[q.id]?.optionIds || [])[0] || ''}
              onChange={(e) => setSelect(q.id, e.target.value)}
              required={q.isRequired}
              disabled={formDisabled}
            >
              <option value="">— Выберите —</option>
              {q.options.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.text}
                </option>
              ))}
            </select>
            {(() => {
              const selectedId = (answers[q.id]?.optionIds || [])[0];
              const selectedOpt = q.options.find((o) => o.id === selectedId);
              if (!selectedOpt || !isOtherOptionText(selectedOpt.text)) return null;
              return (
                <input
                  type="text"
                  style={{ marginTop: 8 }}
                  value={answers[q.id]?.otherTexts?.[selectedId] || ''}
                  onChange={(e) => setOtherText(q.id, selectedId, e.target.value)}
                  disabled={formDisabled}
                  required
                  placeholder="Укажите свой вариант"
                />
              );
            })()}
          </div>
        ) : (
          <div className="option-list">
            {q.options.map((opt) => {
              const selected = (answers[q.id]?.optionIds || []).includes(opt.id);
              const multi = q.allowMultiple !== false;
              const isOther = isOtherOptionText(opt.text);
              return (
                <div key={opt.id}>
                  <label className={`option ${selected ? 'checked' : ''}`}>
                    <input
                      type={multi ? 'checkbox' : 'radio'}
                      name={multi ? undefined : `q-${q.id}`}
                      checked={selected}
                      disabled={formDisabled}
                      onChange={() =>
                        multi ? toggleOption(q.id, opt.id) : setSingleOption(q.id, opt.id)
                      }
                    />
                    <span>{opt.text}</span>
                  </label>
                  {isOther && selected && (
                    <div className="field" style={{ marginTop: 8, marginLeft: 28 }}>
                      <input
                        type="text"
                        value={answers[q.id]?.otherTexts?.[opt.id] || ''}
                        onChange={(e) => setOtherText(q.id, opt.id, e.target.value)}
                        disabled={formDisabled}
                        required
                        placeholder="Укажите свой вариант"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const submitButton = (
    <button
      ref={submitRef}
      className="btn btn-accent btn-block"
      type="submit"
      disabled={!canSubmit || busy}
    >
      {busy
        ? 'Сохранение…'
        : skipAudio
          ? 'Сохранить проведение'
          : 'Сохранить проведение с записью'}
    </button>
  );

  return (
    <div>
      <p className="muted" style={{ marginBottom: 8 }}>
        <Link to="/">← К списку</Link>
      </p>
      <h1 className="page-title">{survey.title}</h1>
      {survey.description && <p className="page-sub">{survey.description}</p>}

      {error && <div className="alert" style={{ marginBottom: 12 }}>{error}</div>}
      {ok && <div className="alert alert-ok" style={{ marginBottom: 12 }}>{ok}</div>}
      {!skipAudio && recorder.error && (
        <div className="alert" style={{ marginBottom: 12 }}>{recorder.error}</div>
      )}

      <div className={`recorder-panel ${!skipAudio && recorder.isRecording ? 'recorder-live' : ''}`}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <strong>{skipAudio ? 'Проведение без записи' : 'Запись голоса'}</strong>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              {skipAudio
                ? sessionActive
                  ? 'Заполняйте ответы и сохраните проведение'
                  : 'Микрофон не нужен — можно проводить опрос без аудио'
                : recorder.isRecording
                  ? 'Идёт запись — заполняйте ответы, затем сохраните проведение'
                  : 'Перед опросом включите микрофон планшета'}
            </p>
          </div>
          {!skipAudio && (
            <div className="recorder-timer" aria-live="polite">
              {recorder.isRecording && <span className="rec-dot" aria-hidden />}
              {recorder.formattedDuration}
            </div>
          )}
        </div>

        {!sessionActive && (
          <>
            <label className="checkbox-row" style={{ marginTop: 12 }}>
              <input
                type="checkbox"
                checked={skipAudio}
                onChange={(e) => {
                  setSkipAudio(e.target.checked);
                  setError('');
                  recorder.reset();
                }}
              />
              <span>Без записи голоса</span>
            </label>
            <button
              type="button"
              className="btn btn-primary btn-block"
              style={{ marginTop: 12 }}
              onClick={beginSession}
              disabled={survey.status !== 'active'}
            >
              {skipAudio ? 'Начать проведение' : 'Начать запись и проведение'}
            </button>
          </>
        )}
      </div>

      <form className="stack" onSubmit={submit} style={{ marginTop: 16 }}>
        <div className="field panel">
          <label htmlFor="note">Пометка / респондент (необязательно)</label>
          <input
            id="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Имя, номер, комментарий"
            disabled={formDisabled}
          />
        </div>

        {isStepMode ? (
          <div className="conduct-step stack">
            {sessionActive && (
              <p className="muted conduct-step-progress" aria-live="polite">
                {stepPhase === 'submit'
                  ? 'Завершение'
                  : `Вопрос ${stepIndex + 1} из ${visibleQuestions.length || 1}`}
              </p>
            )}

            {stepPhase === 'questions' && currentStepQuestion
              ? renderQuestion(currentStepQuestion)
              : null}

            {stepPhase === 'submit' && (
              <div className="question-block">
                <h3>Готово к сохранению</h3>
                <p className="muted" style={{ margin: 0 }}>
                  Проверьте пометку респондента при необходимости и сохраните проведение.
                </p>
              </div>
            )}

            {sessionActive && (
              <div className="conduct-step-nav">
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={formDisabled || !canGoPrev}
                  onClick={goStepPrev}
                >
                  ← Назад
                </button>
                {stepPhase === 'questions' ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={formDisabled}
                    onClick={goStepNext}
                  >
                    {isLastReachable ? 'К сохранению →' : 'Далее →'}
                  </button>
                ) : (
                  submitButton
                )}
              </div>
            )}
          </div>
        ) : (
          <>
            {visibleQuestions.map((q) => renderQuestion(q))}
            {submitButton}
          </>
        )}
      </form>
    </div>
  );
}
