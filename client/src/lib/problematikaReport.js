import { buildQuestionCharts, isChoiceQuestion } from './surveyAnalytics';

export const DISTRICT_FULL = 'Сергиево - Посадский городской округ';
export const DISTRICT_CODE = 'СПГО';

/** Municipal problematika report (HTML / PPTX) is limited to this survey. */
export const PROBLEMATIKA_PPTX_SURVEY_TITLE = 'Опросник по проблематике — ноябрь 2026';

function normalizeSurveyTitle(title) {
  return String(title || '')
    .replace(/[—–−‐-]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function isProblematikaPptxSurvey(survey) {
  return (
    normalizeSurveyTitle(survey?.title) ===
    normalizeSurveyTitle(PROBLEMATIKA_PPTX_SURVEY_TITLE)
  );
}

/** e.g. 4кв26 / ноябрь 2026 */
export function quarterParts(date = new Date()) {
  const q = Math.floor(date.getMonth() / 3) + 1;
  const yy = String(date.getFullYear()).slice(-2);
  const months = [
    'январь',
    'февраль',
    'март',
    'апрель',
    'май',
    'июнь',
    'июль',
    'август',
    'сентябрь',
    'октябрь',
    'ноябрь',
    'декабрь',
  ];
  return {
    quarterCode: `${q}кв${yy}`,
    quarterRoman: `${['I', 'II', 'III', 'IV'][q - 1]} кв. ${date.getFullYear()}`,
    monthYear: `${months[date.getMonth()]} ${date.getFullYear()} года`,
  };
}

/**
 * Map survey choice questions → report chart slots.
 * For the November problematika questionnaire, match by known stems.
 */
export function mapSurveyToPptxSlots(survey, items) {
  const charts = buildQuestionCharts(survey?.questions || [], items);
  const byId = new Map(charts.map((c) => [Number(c.questionId), c]));
  const questions = (survey?.questions || []).filter(isChoiceQuestion);

  const take = (pred) => {
    const q = questions.find((question) => pred(String(question.text || ''), question));
    return q ? byId.get(Number(q.id)) : null;
  };

  const gender =
    take((t) => /^\s*пол\b/i.test(t) && !/положен/i.test(t)) ||
    take((t) => /(^|[^а-яё])пол([^а-яё]|$)/i.test(t) && !/положен|полных\s+лет/i.test(t)) ||
    charts.find((c) => {
      const labels = (c.slices || []).map((s) => s.label.toLowerCase());
      return labels.some((l) => /муж/i.test(l)) && labels.some((l) => /жен/i.test(l));
    });

  const age =
    take((t) => /сколько\s+вам\s+полных\s+лет|возраст/i.test(t)) ||
    charts.find((c) => {
      const labels = (c.slices || []).map((s) => s.label.toLowerCase()).join(' ');
      return /\d+\s*[-–]\s*\d+/.test(labels) && /лет/i.test(labels);
    });

  const profession = take((t) => /основное\s+занятие|професс|род\s*занят|занятост|кем\s*работа/i.test(t));
  const industry = take((t) => /в\s+какой\s+сфере\s+вы\s+работа|отрасл|сфера\s*занят|вид\s*деятельн/i.test(t));
  const overall = take(
    (t) =>
      /довольн\w*\s+или\s+не\s+довольн|положением\s+дел\s+в\s+вашем\s+округе|общ\w*\s+ситуаци/i.test(t) &&
      !/сфер[еы]/i.test(t)
  );
  const head = take((t) => /деятельност\w*\s+глав|глав[аые]\s+муницип|оцен.*руковод/i.test(t));
  const sources = take((t) => /источник\w*\s+вы\s+преимуществен|источник|информир|получаете.*информац/i.test(t));

  const used = new Set(
    [gender, age, profession, industry, overall, head, sources]
      .filter(Boolean)
      .map((c) => Number(c.questionId))
  );

  const sphereCharts = questions
    .filter((q) => {
      if (used.has(Number(q.id))) return false;
      const t = String(q.text || '');
      return /удовлетворен/i.test(t) && /сфер/i.test(t) && !/не\s+устраивает/i.test(t);
    })
    .map((q) => byId.get(Number(q.id)))
    .filter(Boolean);

  const sphereIds = new Set(sphereCharts.map((c) => Number(c.questionId)));

  const interactionPreds = [
    (t) => /проводились\s+ли\s+местной\s+администрацией|мероприятия,\s*встречи\s+с\s+жителями/i.test(t),
    (t) => /необходимы\s+ли\s+такие\s+мероприятия/i.test(t),
    (t) => /готовы\s+ли\s+вы\s+сами\s+принимать\s+участие/i.test(t),
    (t) => /выездн[а-яё]*\s+администраци/i.test(t),
  ];
  const interactionTaken = new Set();
  const interaction = interactionPreds
    .map((pred) => {
      const ch = take(pred);
      if (!ch) return null;
      const id = Number(ch.questionId);
      if (used.has(id) || sphereIds.has(id) || interactionTaken.has(id)) return null;
      interactionTaken.add(id);
      return ch;
    })
    .filter(Boolean);

  return {
    charts,
    gender,
    age,
    profession: industry || profession,
    overall,
    head,
    sources,
    spheres: sphereCharts.slice(0, 3),
    interaction: interaction.slice(0, 4),
  };
}
