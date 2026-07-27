export function normalizeJumpAction(action) {
  return ['none', 'jump', 'end'].includes(action) ? action : 'none';
}

export function validateJumpConfiguration(questions) {
  const indexed = (questions || []).map((q, index) => ({ ...q, index }));

  for (const q of indexed) {
    if (q.answerType !== 'checkbox' && q.answerType !== 'select') continue;
    for (const opt of q.options || []) {
      const action = normalizeJumpAction(opt.jumpAction);
      if (action === 'none') continue;
      if (action === 'end') continue;

      const targetIndex = Number(opt.jumpToQuestionIndex);
      if (!Number.isInteger(targetIndex)) {
        return `Для варианта «${String(opt.text || '').slice(0, 80)}» не выбран целевой вопрос`;
      }
      if (targetIndex <= q.index || targetIndex >= indexed.length) {
        return `Переход для варианта «${String(opt.text || '').slice(0, 80)}» должен вести только на следующий или более поздний вопрос`;
      }

      const blocked = indexed.slice(q.index + 1, targetIndex).find((mid) => mid.isRequired);
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

  const targetIndices = selectedOptions
    .filter((opt) => normalizeJumpAction(opt.jumpAction) === 'jump' && opt.jumpTargetQuestionId)
    .map((opt) => questionIndexById.get(Number(opt.jumpTargetQuestionId)))
    .filter((v) => Number.isInteger(v));

  if (targetIndices.length) return Math.min(...targetIndices);

  const hasEnd = selectedOptions.some((opt) => normalizeJumpAction(opt.jumpAction) === 'end');
  return hasEnd ? 'end' : null;
}

export function buildReachableQuestionIds(questions, answersByQuestionId) {
  const reachable = [];
  const questionIndexById = new Map((questions || []).map((q, index) => [Number(q.id), index]));

  let index = 0;
  while (index >= 0 && index < (questions || []).length) {
    const question = questions[index];
    reachable.push(Number(question.id));

    const answer = answersByQuestionId.get(Number(question.id));
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
