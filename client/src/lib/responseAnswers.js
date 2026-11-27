import { formatOptionAnswer } from './options';

/** Format answers for one question the same way as on the results page. */
export function answerText(question, itemAnswers) {
  const ans = (itemAnswers || []).filter((a) => a.questionId === question.id);
  if (question.answerType === 'text' || question.answerType === 'address') {
    return ans[0]?.textValue || '—';
  }
  const texts = ans
    .map((a) => formatOptionAnswer(a.optionText, a.textValue))
    .filter(Boolean);
  return texts.length ? texts.join(', ') : '—';
}

export function formatGeoCoords(geo) {
  const lat = Number(geo?.lat);
  const lng = Number(geo?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}
