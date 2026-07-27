export function normalizeJumpAction(action) {
  return ['none', 'jump', 'end'].includes(action) ? action : 'none';
}

export function validateJumpConfiguration(questions) {
  const list = (questions || []).map((q, index) => ({ ...q, index }));

  for (const q of list) {
    if (q.answerType !== 'checkbox' && q.answerType !== 'select') continue;
    for (const opt of q.options || []) {
      const action = normalizeJumpAction(opt.jumpAction);
      if (action === 'none' || action === 'end') continue;

      const targetIndex = Number(opt.jumpToQuestionIndex);
      if (!Number.isInteger(targetIndex)) {
        return `Для варианта «${String(opt.text || '').slice(0, 80)}» не выбран целевой вопрос`;
      }
      if (targetIndex <= q.index || targetIndex >= list.length) {
        return `Переход для варианта «${String(opt.text || '').slice(0, 80)}» должен вести только вперёд`;
      }
      const blocked = list.slice(q.index + 1, targetIndex).find((mid) => mid.isRequired);
      if (blocked) {
        return (
          `Нельзя сохранить переход с вопроса ${q.index + 1} (вариант «${String(opt.text || '').slice(0, 80)}») ` +
          `через обязательный вопрос ${blocked.index + 1}: «${blocked.text}». ` +
          `Снимите «Обязательный» у вопроса ${blocked.index + 1} или измените/уберите переход.`
        );
      }
    }
  }

  return null;
}

export function resolveJumpFromAnswer(question, answer, questionIndexById) {
  if (!question || !answer) return null;
  if (question.answerType !== 'checkbox' && question.answerType !== 'select') return null;

  const selectedIds = (answer.optionIds || []).map(Number).filter(Boolean);
  const selectedOptions = (question.options || []).filter((opt) => selectedIds.includes(Number(opt.id)));
  if (!selectedOptions.length) return null;

  const targets = [];
  for (const opt of selectedOptions) {
    if (normalizeJumpAction(opt.jumpAction) !== 'jump') continue;
    let targetIndex = null;
    if (opt.jumpToQuestionIndex != null && opt.jumpToQuestionIndex !== '') {
      const n = Number(opt.jumpToQuestionIndex);
      if (Number.isInteger(n)) targetIndex = n;
    }
    if (
      targetIndex == null &&
      opt.jumpTargetQuestionId != null &&
      questionIndexById instanceof Map
    ) {
      const mapped = questionIndexById.get(Number(opt.jumpTargetQuestionId));
      if (Number.isInteger(mapped)) targetIndex = mapped;
    }
    if (Number.isInteger(targetIndex)) targets.push(targetIndex);
  }
  if (targets.length) return Math.min(...targets);

  return selectedOptions.some((opt) => normalizeJumpAction(opt.jumpAction) === 'end') ? 'end' : null;
}

export function buildReachableQuestionIds(questions, answers) {
  const reachable = [];
  const questionIndexById = new Map((questions || []).map((q, index) => [Number(q.id), index]));

  let index = 0;
  while (index >= 0 && index < (questions || []).length) {
    const question = questions[index];
    reachable.push(Number(question.id));
    const answer = answers[question.id];
    const jump = resolveJumpFromAnswer(question, answer, questionIndexById);
    if (jump === 'end') break;
    if (Number.isInteger(jump) && jump > index) {
      index = jump;
    } else {
      index += 1;
    }
  }

  return reachable;
}
