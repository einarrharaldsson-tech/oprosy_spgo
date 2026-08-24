const PIE_COLORS = [
  '#0f3d3e',
  '#c45c26',
  '#1a5c5e',
  '#1f6b4a',
  '#a33b2d',
  '#4a7c7e',
  '#8a6d3b',
  '#3d5556',
  '#2d6a9f',
  '#7a4ea3',
];

export const CHART_COLORS = PIE_COLORS;

export function isChoiceQuestion(question) {
  return question?.answerType === 'checkbox' || question?.answerType === 'select';
}

export function isMultiChoice(question) {
  return question?.answerType === 'checkbox' && question.allowMultiple !== false;
}

function roundPercent(count, total) {
  if (!total) return 0;
  return Math.round((count / total) * 1000) / 10;
}

/**
 * Build pie-chart datasets for choice questions.
 * Percent is share of survey sessions (проведения), not of pie area for multi-select.
 */
export function buildQuestionCharts(questions, items) {
  const totalSessions = items.length;
  return (questions || [])
    .filter(isChoiceQuestion)
    .map((question) => {
      const buckets = new Map();
      for (const option of question.options || []) {
        buckets.set(option.id, {
          id: option.id,
          label: String(option.text || 'Вариант').trim() || 'Вариант',
          count: 0,
          otherTexts: [],
        });
      }

      let unanswered = 0;
      for (const item of items) {
        const answers = (item.answers || []).filter(
          (answer) => answer.questionId === question.id && answer.optionId
        );
        if (!answers.length) {
          unanswered += 1;
          continue;
        }
        const seen = new Set();
        for (const answer of answers) {
          if (seen.has(answer.optionId)) continue;
          seen.add(answer.optionId);
          let bucket = buckets.get(answer.optionId);
          if (!bucket) {
            bucket = {
              id: answer.optionId,
              label: String(answer.optionText || 'Вариант').trim() || 'Вариант',
              count: 0,
              otherTexts: [],
            };
            buckets.set(answer.optionId, bucket);
          }
          bucket.count += 1;
          const extra = String(answer.textValue || '').trim();
          if (extra) bucket.otherTexts.push(extra);
        }
      }

      const slices = [...buckets.values()]
        .filter((slice) => slice.count > 0)
        .map((slice, index) => ({
          ...slice,
          percent: roundPercent(slice.count, totalSessions),
          color: PIE_COLORS[index % PIE_COLORS.length],
        }));

      if (unanswered > 0) {
        slices.push({
          id: 'unanswered',
          label: 'Без ответа',
          count: unanswered,
          otherTexts: [],
          percent: roundPercent(unanswered, totalSessions),
          color: '#9aa8a8',
        });
      }

      return {
        questionId: question.id,
        questionText: question.text,
        multiple: isMultiChoice(question),
        totalSessions,
        unanswered,
        slices,
      };
    });
}

export function piePath(cx, cy, radius, startAngle, endAngle) {
  const polar = (angle) => {
    const rad = ((angle - 90) * Math.PI) / 180;
    return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)];
  };
  const [x1, y1] = polar(startAngle);
  const [x2, y2] = polar(endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;
}
