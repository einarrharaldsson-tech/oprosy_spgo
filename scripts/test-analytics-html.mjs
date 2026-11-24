/**
 * Smoke test for problematika HTML deck builder.
 * Usage: node scripts/test-analytics-html.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function rewrite(srcPath, replacers) {
  let source = fs.readFileSync(srcPath, 'utf8');
  for (const [from, to] of replacers) source = source.split(from).join(to);
  return source;
}

const surveyAnalytics = path.join(ROOT, 'client/src/lib/surveyAnalytics.js');
const optionsJs = path.join(ROOT, 'client/src/lib/options.js');
const reportJs = path.join(ROOT, 'client/src/lib/problematikaReport.js');
const htmlJs = path.join(ROOT, 'client/src/lib/downloadAnalyticsHtml.js');

const tmpReport = '/tmp/problematikaReport-test.mjs';
const tmpHtml = '/tmp/downloadAnalyticsHtml-test.mjs';

fs.writeFileSync(
  tmpReport,
  rewrite(reportJs, [
    [
      "import { buildQuestionCharts, isChoiceQuestion } from './surveyAnalytics';",
      `import { buildQuestionCharts, isChoiceQuestion } from '${surveyAnalytics}';`,
    ],
  ])
);

fs.writeFileSync(
  tmpHtml,
  rewrite(htmlJs, [
    ["import gerbUrl from '../assets/report/spgo-gerb.png';\n", 'const gerbUrl = "";\n'],
    [
      "import { piePath, CHART_COLORS } from './surveyAnalytics';",
      `import { piePath, CHART_COLORS } from '${surveyAnalytics}';`,
    ],
    ["from './problematikaReport';", `from '${tmpReport}';`],
  ])
);

const { buildAnalyticsHtmlString, analyticsHtmlFilename, isProblematikaPptxSurvey } = await import(
  pathToFileURL(tmpHtml).href
);
const { mapSurveyToPptxSlots } = await import(pathToFileURL(tmpReport).href);

const survey = {
  title: 'Опросник по проблематике — ноябрь 2026',
  questions: [
    {
      id: 1,
      text: 'Пол.',
      answerType: 'checkbox',
      allowMultiple: false,
      options: [
        { id: 1, text: 'Мужской' },
        { id: 2, text: 'Женский' },
      ],
    },
    {
      id: 2,
      text: 'Сколько Вам полных лет?',
      answerType: 'checkbox',
      allowMultiple: false,
      options: [
        { id: 1, text: '18-29 лет' },
        { id: 2, text: '30-44 лет' },
        { id: 3, text: '45-60 лет' },
        { id: 4, text: '61 год и старше' },
      ],
    },
    {
      id: 5,
      text: 'Вы в целом довольны или не довольны положением дел в Вашем округе?',
      answerType: 'checkbox',
      allowMultiple: false,
      options: [
        { id: 1, text: 'Скорее доволен' },
        { id: 2, text: 'Скорее не доволен' },
        { id: 3, text: 'Затрудняюсь ответить' },
      ],
    },
  ],
};

const items = Array.from({ length: 200 }, (_, i) => ({
  sessionNumber: i + 1,
  answers: [
    {
      questionId: 1,
      optionId: i < 90 ? 1 : 2,
      optionText: i < 90 ? 'Мужской' : 'Женский',
    },
    {
      questionId: 2,
      optionId: (i % 4) + 1,
      optionText: survey.questions[1].options[i % 4].text,
    },
    {
      questionId: 5,
      optionId: (i % 3) + 1,
      optionText: survey.questions[2].options[i % 3].text,
    },
  ],
}));

const slots = mapSurveyToPptxSlots(survey, items);
const html = await buildAnalyticsHtmlString({ survey, items });
const outPath = path.join('/opt/cursor/artifacts', analyticsHtmlFilename().replace(/\s+/g, '_'));
fs.mkdirSync('/opt/cursor/artifacts', { recursive: true });
fs.writeFileSync(outPath, html);

console.log(
  JSON.stringify(
    {
      ok: true,
      out: outPath,
      bytes: html.length,
      gated: isProblematikaPptxSurvey(survey),
      hasMale45: />(45|45\.0)%</.test(html),
      hasFemale55: />(55|55\.0)%</.test(html),
      gender: !!slots.gender,
      overall: !!slots.overall,
      slides: (html.match(/class="slide/g) || []).length,
      filename: analyticsHtmlFilename(),
    },
    null,
    2
  )
);

// silence unused
void optionsJs;
