/**
 * Local smoke test for problematika PPTX builder (no VPS deploy).
 * Usage: node scripts/test-analytics-pptx.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'client/package.json'));

// Minimal uncompressed RGB PNG (no deps).
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const typeBuf = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcBuf = Buffer.alloc(4);
  const both = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(both));
  return Buffer.concat([len, both, crcBuf]);
}
function solidPng(width, height, rgb = [20, 90, 100], dots = []) {
  const row = Buffer.alloc(1 + width * 3);
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    row[0] = 0;
    for (let x = 0; x < width; x += 1) {
      const o = 1 + x * 3;
      row[o] = rgb[0];
      row[o + 1] = rgb[1];
      row[o + 2] = rgb[2];
    }
    for (const d of dots) {
      if (Math.abs(d.x - width / 2) < width && Math.hypot(d.x - 0, d.y - y) < 1000) {
        /* paint below */
      }
    }
    rows.push(Buffer.from(row));
  }
  // paint dots
  for (const d of dots) {
    const r = d.r || 4;
    for (let y = Math.max(0, d.y - r); y <= Math.min(height - 1, d.y + r); y += 1) {
      for (let x = Math.max(0, d.x - r); x <= Math.min(width - 1, d.x + r); x += 1) {
        if ((x - d.x) ** 2 + (y - d.y) ** 2 <= r * r) {
          const o = 1 + x * 3;
          rows[y][o] = d.rgb?.[0] ?? 220;
          rows[y][o + 1] = d.rgb?.[1] ?? 80;
          rows[y][o + 2] = d.rgb?.[2] ?? 40;
        }
      }
    }
  }
  const raw = Buffer.concat(rows);
  const zlib = require('zlib');
  const compressed = zlib.deflateSync(raw);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Load client module with Vite asset imports stubbed via temp rewrite.
const srcPath = path.join(ROOT, 'client/src/lib/downloadAnalyticsPptx.js');
let source = fs.readFileSync(srcPath, 'utf8');
source = source
  .replace(
    "import JSZip from 'jszip';",
    `import JSZip from '${pathToFileURL(path.join(ROOT, 'client/node_modules/jszip/lib/index.js')).href}';`
  )
  .replace(
    "import { isOtherOptionText } from './options';",
    `import { isOtherOptionText } from '${path.join(ROOT, 'client/src/lib/options.js')}';`
  )
  .replace(
    "import { buildQuestionCharts, isChoiceQuestion } from './surveyAnalytics';",
    `import { buildQuestionCharts, isChoiceQuestion } from '${path.join(ROOT, 'client/src/lib/surveyAnalytics.js')}';`
  )
  .replace(
    "import templateUrl from '../assets/report/problematika-template.pptx?url';\n",
    ''
  )
  .replace("import gerbUrl from '../assets/report/spgo-gerb.png';\n", '')
  .replace(
    'const templateBytes = templateBytesOpt || (await fetchBinary(templateUrl));',
    'const templateBytes = templateBytesOpt;'
  )
  .replace(
    'const gerbBytes = gerbBytesOpt || (await fetchBinary(gerbUrl));',
    'const gerbBytes = gerbBytesOpt;'
  );

const tmp = '/tmp/downloadAnalyticsPptx-test.mjs';
fs.writeFileSync(tmp, source);
const { buildAnalyticsPptxBuffer, analyticsPptxFilename, mapSurveyToPptxSlots } = await import(
  pathToFileURL(tmp).href
);

const survey = {
  title: 'Проблематика СПГО',
  questions: [
    {
      id: 1,
      text: 'Ваш пол',
      answerType: 'select',
      options: [
        { id: 1, text: 'Мужской' },
        { id: 2, text: 'Женский' },
      ],
    },
    {
      id: 2,
      text: 'Ваш возраст',
      answerType: 'select',
      options: [
        { id: 1, text: '18-29 лет' },
        { id: 2, text: '30-44 года' },
        { id: 3, text: '45-60 лет' },
        { id: 4, text: '61 год и старше' },
      ],
    },
    {
      id: 3,
      text: 'Ваш род занятий / профессия',
      answerType: 'select',
      options: [
        { id: 1, text: 'Рабочий' },
        { id: 2, text: 'Офисный работник' },
        { id: 3, text: 'Неработающий пенсионер' },
        { id: 4, text: 'Другое (укажите)' },
      ],
    },
    {
      id: 4,
      text: 'В какой сфере / отрасли вы работаете',
      answerType: 'select',
      options: [
        { id: 1, text: 'Образование' },
        { id: 2, text: 'Здравоохранение' },
        { id: 3, text: 'ЖКХ' },
        { id: 4, text: 'Другое (укажите)' },
      ],
    },
    {
      id: 5,
      text: 'Как вы оцениваете общую ситуацию в округе',
      answerType: 'select',
      options: [
        { id: 1, text: 'Скорее доволен' },
        { id: 2, text: 'Скорее не доволен' },
        { id: 3, text: 'Затрудняюсь ответить' },
      ],
    },
    {
      id: 6,
      text: 'Оценка деятельности главы округа',
      answerType: 'select',
      options: [
        { id: 1, text: 'Скорее положительно' },
        { id: 2, text: 'Скорее отрицательно' },
        { id: 3, text: 'Затрудняюсь ответить' },
      ],
    },
    {
      id: 7,
      text: 'Удовлетворённость сферой ЖКХ',
      answerType: 'select',
      options: [
        { id: 1, text: 'Удовлетворен' },
        { id: 2, text: 'Не удовлетворен' },
        { id: 3, text: 'Затрудняюсь ответить' },
        { id: 4, text: 'Другое (укажите)' },
      ],
    },
    {
      id: 8,
      text: 'Удовлетворённость сферой образования',
      answerType: 'select',
      options: [
        { id: 1, text: 'Удовлетворен' },
        { id: 2, text: 'Не удовлетворен' },
        { id: 3, text: 'Затрудняюсь ответить' },
      ],
    },
    {
      id: 9,
      text: 'Удовлетворённость сферой здравоохранения',
      answerType: 'select',
      options: [
        { id: 1, text: 'Удовлетворен' },
        { id: 2, text: 'Не удовлетворен' },
        { id: 3, text: 'Затрудняюсь ответить' },
      ],
    },
    {
      id: 10,
      text: 'Основные источники информирования',
      answerType: 'checkbox',
      allowMultiple: true,
      options: [
        { id: 1, text: 'Телевидение' },
        { id: 2, text: 'ТГ-каналы' },
        { id: 3, text: 'Сарафанное радио' },
        { id: 4, text: 'Другое (укажите)' },
      ],
    },
    {
      id: 11,
      text: 'Проводились ли местной администрацией мероприятия, встречи с жителями',
      answerType: 'select',
      options: [
        { id: 1, text: 'Проводились, информирован' },
        { id: 2, text: 'Что-то слышал' },
        { id: 3, text: 'Не слышал' },
        { id: 4, text: 'Затрудняюсь' },
      ],
    },
    {
      id: 12,
      text: 'Необходимы ли такие мероприятия',
      answerType: 'select',
      options: [
        { id: 1, text: 'Да, необходимы' },
        { id: 2, text: 'Нет, не нужны' },
        { id: 3, text: 'Затрудняюсь' },
      ],
    },
    {
      id: 13,
      text: 'Готовы ли Вы сами принимать участие в таких мероприятиях',
      answerType: 'select',
      options: [
        { id: 1, text: 'Да, обязательно' },
        { id: 2, text: 'Скорее буду' },
        { id: 3, text: 'Скорее не буду' },
        { id: 4, text: 'Точно не буду' },
      ],
    },
    {
      id: 14,
      text: 'Знаете ли Вы о таком виде мероприятий как «Выездная Администрация»',
      answerType: 'select',
      options: [
        { id: 1, text: 'Знаю хорошо' },
        { id: 2, text: 'Что-то знаю' },
        { id: 3, text: 'Ничего не знаю' },
        { id: 4, text: 'Затрудняюсь' },
      ],
    },
  ],
};

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

const items = Array.from({ length: 40 }, (_, i) => {
  const answers = survey.questions.map((q) => {
    const opt = pick(q.options);
    const a = {
      questionId: q.id,
      optionId: opt.id,
      optionText: opt.text,
    };
    if (/^другое/i.test(opt.text)) a.textValue = `вариант-${i}`;
    return a;
  });
  // multi for sources: maybe 2 options
  const src = survey.questions.find((q) => q.id === 10);
  const o2 = pick(src.options);
  answers.push({
    questionId: 10,
    optionId: o2.id,
    optionText: o2.text,
  });
  return {
    sessionNumber: i + 1,
    geo: {
      lat: 56.3 + Math.random() * 0.15,
      lng: 38.1 + Math.random() * 0.2,
    },
    answers,
  };
});

const slots = mapSurveyToPptxSlots(survey, items);
console.log('slots', {
  gender: !!slots.gender,
  age: !!slots.age,
  profession: !!slots.profession,
  industry: !!slots.industry,
  overall: !!slots.overall,
  head: !!slots.head,
  sources: !!slots.sources,
  spheres: slots.spheres.map((s) => s.questionText),
  interaction: slots.interaction.map((s) => s.questionText),
});

const overview = solidPng(640, 480, [30, 110, 120], [
  { x: 200, y: 180, r: 6 },
  { x: 320, y: 240, r: 8 },
  { x: 420, y: 300, r: 5 },
  { x: 280, y: 320, r: 7 },
]);
const zoom = solidPng(320, 240, [40, 130, 140], [
  { x: 160, y: 120, r: 10, rgb: [230, 70, 40] },
]);

const templateBytes = fs.readFileSync(
  path.join(ROOT, 'client/src/assets/report/problematika-template.pptx')
);
const gerbBytes = fs.readFileSync(
  path.join(ROOT, 'client/src/assets/report/spgo-gerb.png')
);

const t0 = Date.now();
const bytes = await buildAnalyticsPptxBuffer({
  survey,
  items,
  templateBytes,
  gerbBytes,
  mapImages: {
    overview,
    zooms: [zoom, zoom, zoom, zoom],
    overviewAlt: overview,
    overviewAlt2: overview,
  },
});
const elapsed = Date.now() - t0;

const outName = analyticsPptxFilename();
const outPath = path.join('/opt/cursor/artifacts', outName.replace(/\s+/g, '_'));
fs.mkdirSync('/opt/cursor/artifacts', { recursive: true });
fs.writeFileSync(outPath, bytes);

// Validate zip + key strings
const JSZip = (await import(pathToFileURL(path.join(ROOT, 'client/node_modules/jszip/lib/index.js')).href)).default;
const zip = await JSZip.loadAsync(bytes);
const slide1 = await zip.file('ppt/slides/slide1.xml').async('string');
const hasDistrict = slide1.includes('Сергиево - Посадский городской округ');
const hasSlide2 = !!zip.file('ppt/slides/slide2.xml');
const hasSlide3 = !!zip.file('ppt/slides/slide3.xml');
const hasSlide6 = !!zip.file('ppt/slides/slide6.xml');
const media = Object.keys(zip.files).filter((f) => f.startsWith('ppt/media/'));
const chart1 = await zip.file('ppt/charts/chart1.xml').async('string');

console.log(
  JSON.stringify(
    {
      ok: true,
      out: outPath,
      bytes: bytes.length,
      elapsedMs: elapsed,
      filename: outName,
      hasDistrict,
      slides12: !!zip.file('ppt/slides/slide12.xml') && !zip.file('ppt/slides/slide13.xml'),
      keptGeoSlides: !!zip.file('ppt/slides/slide2.xml') && !!zip.file('ppt/slides/slide3.xml') && !!zip.file('ppt/slides/slide4.xml'),
      contextGeo: (await zip.file('ppt/slides/slide2.xml').async('string')).includes('опрошено'),
      mediaCount: media.length,
      chart1HasMale: chart1.includes('Мужской'),
    },
    null,
    2
  )
);
