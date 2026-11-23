import JSZip from 'jszip';
import { isOtherOptionText } from './options';
import { buildQuestionCharts, isChoiceQuestion } from './surveyAnalytics';
import templateUrl from '../assets/report/problematika-template.pptx?url';
import gerbUrl from '../assets/report/spgo-gerb.png';

export const DISTRICT_FULL = 'Сергиево - Посадский городской округ';
export const DISTRICT_CODE = 'СПГО';

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

export function analyticsPptxFilename(district = DISTRICT_CODE, date = new Date()) {
  return `${district} - проблематика в ${quarterParts(date).quarterCode}.pptx`;
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function slicesToRows(slices, { dropZero = true, otherLast = true } = {}) {
  let rows = (slices || [])
    .filter((s) => s.id !== 'unanswered')
    .map((s) => {
      const percent = typeof s.percent === 'number' ? s.percent : 0;
      return {
        label: String(s.label || '').trim() || 'Вариант',
        share: percent / 100,
        count: s.count,
        isOther: isOtherOptionText(s.label),
        otherTexts: s.otherTexts || [],
      };
    });
  if (dropZero) rows = rows.filter((r) => r.share > 0 || r.count > 0);
  if (otherLast) {
    const other = rows.filter((r) => r.isOther);
    const rest = rows.filter((r) => !r.isOther).sort((a, b) => b.share - a.share);
    rows = [...rest, ...other];
  } else {
    rows = rows.sort((a, b) => b.share - a.share);
  }
  return rows;
}

function chartRowsFromQuestion(chart) {
  if (!chart) return [];
  return slicesToRows(chart.slices || []);
}

/** Heuristic mapping of survey questions → template slots. */
export function mapSurveyToPptxSlots(survey, items) {
  const charts = buildQuestionCharts(survey?.questions || [], items);
  const byId = new Map(charts.map((c) => [c.questionId, c]));
  const questions = (survey?.questions || []).filter(isChoiceQuestion);

  const take = (pred) => {
    const q = questions.find((question) => pred(String(question.text || ''), question));
    return q ? byId.get(q.id) : null;
  };

  const gender = take((t) => /(^|[^а-яё])пол([^а-яё]|$)/i.test(t) && !/положен/i.test(t));
  const age = take((t) => /возраст/i.test(t));
  const profession = take((t) => /професс|род\s*занят|занятост|кем\s*работа/i.test(t));
  const industry = take((t) => /отрасл|сфера\s*занят|вид\s*деятельн|в\s*какой\s*сфере/i.test(t));
  const overall = take((t) => /ситуаци/i.test(t) && /(округ|муницип|общ)/i.test(t));
  const head = take((t) => /глав[аые]|оцен.*руковод/i.test(t));
  const sources = take((t) => /источник|информир|откуда.*узна|получаете.*информац/i.test(t));

  const used = new Set(
    [gender, age, profession, industry, overall, head, sources]
      .filter(Boolean)
      .map((c) => c.questionId)
  );

  const sphereCharts = charts.filter((c) => {
    if (used.has(c.questionId)) return false;
    const labels = (c.slices || []).map((s) => s.label.toLowerCase()).join(' ');
    return /удовлетвор/.test(labels);
  });

  const interaction = charts.filter((c) => {
    if (used.has(c.questionId)) return false;
    if (sphereCharts.some((s) => s.questionId === c.questionId)) return false;
    const t = String(c.questionText || '');
    return /мероприят|встречу|выездн|администрац|участвовать|взаимодейств/i.test(t);
  });

  return {
    charts,
    gender,
    age,
    // Fixed template keeps a single professional-profile chart (industry/occupation mix).
    profession: industry || profession,
    overall,
    head,
    sources,
    spheres: sphereCharts.slice(0, 3),
    interaction: interaction.slice(0, 4),
  };
}

function buildStrCache(labels) {
  const pts = labels
    .map((label, idx) => `<c:pt idx="${idx}"><c:v>${escapeXml(label)}</c:v></c:pt>`)
    .join('');
  return `<c:strCache><c:ptCount val="${labels.length}"/>${pts}</c:strCache>`;
}

function buildNumCache(values, formatCode = '0%') {
  const pts = values
    .map((v, idx) => `<c:pt idx="${idx}"><c:v>${Number(v)}</c:v></c:pt>`)
    .join('');
  return `<c:numCache><c:formatCode>${formatCode}</c:formatCode><c:ptCount val="${values.length}"/>${pts}</c:numCache>`;
}

function patchSingleSeriesChart(xml, labels, values) {
  let out = xml;
  const n = labels.length;
  out = out.replace(/<c:strCache>[\s\S]*?<\/c:strCache>/, buildStrCache(labels));
  out = out.replace(/<c:numCache>[\s\S]*?<\/c:numCache>/, buildNumCache(values));
  out = out.replace(/Лист1!\$A\$2:\$A\$\d+/g, n > 1 ? `Лист1!$A$2:$A$${n + 1}` : 'Лист1!$A$2');
  out = out.replace(/Лист1!\$B\$2:\$B\$\d+/g, n > 1 ? `Лист1!$B$2:$B$${n + 1}` : 'Лист1!$B$2');
  return out;
}

function patchMultiSeriesChart(xml, seriesRows, categoryLabel) {
  let out = xml;
  const serBlocks = [...out.matchAll(/<c:ser>[\s\S]*?<\/c:ser>/g)].map((m) => m[0]);
  if (!serBlocks.length) return out;

  for (let i = 0; i < serBlocks.length; i += 1) {
    const block = serBlocks[i];
    const row = seriesRows[i];
    let next = block;
    if (!row) {
      next = next.replace(/(<c:numCache>[\s\S]*?<c:v>)([^<]*)(<\/c:v>)/, '$10$3');
      out = out.replace(block, next);
      continue;
    }
    next = next.replace(
      /(<c:tx>[\s\S]*?<c:strCache>[\s\S]*?<c:v>)([^<]*)(<\/c:v>)/,
      `$1${escapeXml(row.label)}$3`
    );
    next = next.replace(
      /(<c:cat>[\s\S]*?<c:strCache>[\s\S]*?<c:v>)([^<]*)(<\/c:v>)/,
      `$1${escapeXml(categoryLabel)}$3`
    );
    next = next.replace(
      /(<c:numCache>[\s\S]*?<c:v>)([^<]*)(<\/c:v>)/,
      `$1${Number(row.share)}$3`
    );
    out = out.replace(block, next);
  }
  return out;
}

async function readText(zip, path) {
  const file = zip.file(path);
  if (!file) return null;
  return file.async('string');
}

async function fetchBinary(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Не удалось загрузить ресурс: ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function toBytes(img) {
  if (!img) return null;
  if (img instanceof Uint8Array) return img;
  if (img instanceof ArrayBuffer) return new Uint8Array(img);
  if (typeof Blob !== 'undefined' && img instanceof Blob) {
    return new Uint8Array(await img.arrayBuffer());
  }
  return null;
}

/** Context line as in the curated sample: (Округ: месяц год, опрошено N) */
function contextParen({ districtFull, monthYear, total }) {
  return `(${districtFull}: ${monthYear}, опрошено ${total})`;
}

/**
 * Replace placeholder / previous context parentheses inside slide XML.
 * Handles both the template hint and an already-filled context string.
 */
function replaceContextParen(slideXml, nextParen) {
  let out = slideXml;
  const escaped = escapeXml(nextParen);
  out = out.replace(
    /\(округ: территории, на которых проводилось исследование, даты и количество опрошенных\)/g,
    escaped
  );
  out = out.replace(
    /\(\s*округ: территории, на которых проводилось исследование, даты и количество опрошенных\)/g,
    escaped
  );
  // Already filled from a previous export / curated template
  out = out.replace(
    /\(Сергиево - Посадский городской округ:[^)]*опрошено\s+\d+\)/g,
    escaped
  );
  return out;
}

function clearAllMatchingText(slideXml, substrings) {
  let out = slideXml;
  for (const block of out.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)) {
    const xml = block[0];
    const text = [...xml.matchAll(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/g)].map((m) => m[1]).join('');
    if (!substrings.some((s) => text.includes(s))) continue;
    const cleared = xml.replace(/<a:t(?:\s[^>]*)?>[^<]*<\/a:t>/g, '<a:t></a:t>');
    out = out.replace(xml, cleared);
  }
  // Also clear table cells (title «Герб муниципального образования»)
  for (const block of out.matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/g)) {
    const xml = block[0];
    const text = [...xml.matchAll(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/g)].map((m) => m[1]).join('');
    if (!substrings.some((s) => text.includes(s))) continue;
    const cleared = xml.replace(/<a:t(?:\s[^>]*)?>[^<]*<\/a:t>/g, '<a:t></a:t>');
    out = out.replace(xml, cleared);
  }
  return out;
}

function fillProblemPercents(slideXml, rows, maxSlots = 12) {
  const percents = rows.slice(0, maxSlots).map((r) => {
    const p = Math.round(r.share * 1000) / 10;
    return `${p}%`;
  });
  let i = 0;
  return slideXml.replace(/<a:t(?:\s[^>]*)?>%<\/a:t>/g, () => {
    if (i >= percents.length) return '<a:t></a:t>';
    const v = percents[i];
    i += 1;
    return `<a:t>${escapeXml(v)}</a:t>`;
  });
}

function setBalance(slideXml, rows) {
  const sat = rows.find(
    (r) => /удовлетворен/i.test(r.label) && !/не\s+удовлетворен/i.test(r.label)
  );
  const unsat = rows.find((r) => /не\s+удовлетворен/i.test(r.label));
  if (!sat || !unsat) return slideXml;
  const balance = Math.round((sat.share - unsat.share) * 1000) / 10;
  const label = `${balance}%`;
  // Curated template keeps label and value in adjacent text runs.
  let out = slideXml.replace(/>Х%</g, `>${escapeXml(label)}<`);
  out = out.replace(
    /(Баланс оценок в сфере:\s*<\/a:t><\/a:r><a:r>[\s\S]*?<a:t(?:\s[^>]*)?>)([^<]*)(<\/a:t>)/,
    `$1${escapeXml(label)}$3`
  );
  // Fallback: value in the same run as the label
  out = out.replace(
    /Баланс оценок в сфере:\s*[^<]*%/g,
    `Баланс оценок в сфере:  ${escapeXml(label)}`
  );
  return out;
}

function setSphereTitle(slideXml, questionText) {
  const title = String(questionText || '').trim();
  if (!title) return slideXml;
  // Curated template: «ПОЛОЖЕНИЕ ДЕЛ В СФЕРЕ  …question…»
  let out = slideXml;
  out = out.replace(/>НАЗВАНИЕ</g, `>${escapeXml(title)}<`);
  // Replace a previous full question after the sphere heading (single text run preferred)
  out = out.replace(
    /(ПОЛОЖЕНИЕ ДЕЛ В СФЕРЕ\s*)([^<]*)/g,
    (_, head, rest) => {
      // Keep only the heading in this run if question is in the next run already
      if (/Вы удовлетворены|удовлетворен/i.test(rest) || rest.trim().length > 5) {
        return `${head}${escapeXml(title)}`;
      }
      return `${head}${rest}`;
    }
  );
  return out;
}

function setOtherTexts(slideXml, rows) {
  const otherTexts = rows.flatMap((r) => (r.isOther ? r.otherTexts || [] : []));
  if (!otherTexts.length) {
    return clearAllMatchingText(slideXml, ['варианты при наличии', 'Другое:']);
  }
  const joined = otherTexts.slice(0, 12).join('; ');
  return slideXml.replace(/Другое\s*:\s*/g, `Другое: ${escapeXml(joined)}`);
}

async function applyChart(zip, chartFile, rows, mode, categoryLabel) {
  const path = `ppt/charts/${chartFile}`;
  const file = zip.file(path);
  if (!file) return;
  let xml = await file.async('string');
  if (!rows?.length) {
    zip.file(path, xml);
    return;
  }
  xml =
    mode === 'multi'
      ? patchMultiSeriesChart(xml, rows, categoryLabel)
      : patchSingleSeriesChart(
          xml,
          rows.map((r) => r.label),
          rows.map((r) => r.share)
        );
  zip.file(path, xml);
}

async function patchSlide(zip, slideNum, mutator) {
  const path = `ppt/slides/slide${slideNum}.xml`;
  let xml = await readText(zip, path);
  if (!xml) return;
  xml = mutator(xml) || xml;
  zip.file(path, xml);
}

/**
 * Build municipal problematika PPTX from the curated official template
 * (12 slides, shared герб/map media, instruction slides already removed).
 */
export async function buildAnalyticsPptxBuffer({
  survey,
  items,
  mapImages = {},
  date = new Date(),
  districtFull = DISTRICT_FULL,
  districtCode = DISTRICT_CODE,
  templateBytes: templateBytesOpt,
  gerbBytes: gerbBytesOpt,
}) {
  const total = items?.length || 0;
  if (!total) throw new Error('Нет данных для презентации');

  const { quarterRoman, monthYear, quarterCode } = quarterParts(date);
  const ctx = contextParen({ districtFull, monthYear, total });
  const slots = mapSurveyToPptxSlots(survey, items);

  const templateBytes = templateBytesOpt || (await fetchBinary(templateUrl));
  const gerbBytes = gerbBytesOpt || (await fetchBinary(gerbUrl));
  const zip = await JSZip.loadAsync(templateBytes);

  // Reuse single media slots like the curated file.
  zip.file('ppt/media/image1.png', gerbBytes);
  const overview =
    (await toBytes(mapImages.overview)) ||
    (await toBytes(mapImages.overviewAlt)) ||
    (await toBytes((mapImages.zooms || [])[0]));
  if (overview) {
    zip.file('ppt/media/image2.png', overview);
  }

  // --- Title ---
  await patchSlide(zip, 1, (s) => {
    let out = s;
    out = out.split('Наименование муниципального образования').join(escapeXml(districtFull));
    out = out.replace(
      /Исследование проблематики,[^<]*/g,
      `Исследование проблематики, ${escapeXml(monthYear)}`
    );
    // If curated template already has district name, keep/refresh period only.
    out = out.split(DISTRICT_FULL).join(escapeXml(districtFull));
    out = clearAllMatchingText(out, ['Герб муниципального', 'герб во всю', 'рамку после вставки герба']);
    return out;
  });

  // --- Geography (slides 2–4) + all content slides: context paren ---
  for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
    await patchSlide(zip, n, (s) => replaceContextParen(s, ctx));
  }

  // Clear leftover geo-comment / frame hints if any remain
  for (const n of [2, 3, 4]) {
    await patchSlide(zip, n, (s) =>
      clearAllMatchingText(s, [
        'Комментарий в случае проблем',
        'рамку после',
        'Общее фото карты',
        'Приближенное фото',
        'Фото карты территории',
      ])
    );
  }

  // --- Charts ---
  await applyChart(zip, 'chart1.xml', chartRowsFromQuestion(slots.gender), 'single');
  await applyChart(zip, 'chart2.xml', chartRowsFromQuestion(slots.age), 'single');
  await applyChart(zip, 'chart3.xml', chartRowsFromQuestion(slots.profession), 'single');
  await applyChart(
    zip,
    'chart4.xml',
    chartRowsFromQuestion(slots.overall),
    'multi',
    quarterRoman
  );
  await applyChart(zip, 'chart5.xml', chartRowsFromQuestion(slots.head), 'multi', quarterRoman);

  for (let i = 0; i < 3; i += 1) {
    const slideNum = 8 + i;
    const chartFile = `chart${6 + i}.xml`;
    const sphere = slots.spheres[i];
    const rows = chartRowsFromQuestion(sphere);
    await applyChart(zip, chartFile, rows, 'single');
    await patchSlide(zip, slideNum, (s) => {
      let out = s;
      out = setSphereTitle(out, sphere?.questionText);
      out = fillProblemPercents(out, rows);
      out = setBalance(out, rows);
      out = setOtherTexts(out, rows);
      out = clearAllMatchingText(out, [
        'Аналогичный делается',
        'Если для анализа',
        'Заполняется в порядке',
        'Если 0%',
        '«Другое» всегда',
        'Баланс =',
        'варианты при наличии',
      ]);
      return out;
    });
  }

  // Slide 7 — overall situation table percents
  await patchSlide(zip, 7, (s) => {
    let out = fillProblemPercents(s, chartRowsFromQuestion(slots.overall));
    out = clearAllMatchingText(out, [
      'Заполняется в порядке',
      'Вносится столько',
      '«Другое» всегда',
    ]);
    return out;
  });

  await applyChart(zip, 'chart9.xml', chartRowsFromQuestion(slots.sources), 'single');

  const interactionCharts = ['chart10.xml', 'chart11.xml', 'chart12.xml', 'chart13.xml'];
  for (let i = 0; i < interactionCharts.length; i += 1) {
    await applyChart(
      zip,
      interactionCharts[i],
      chartRowsFromQuestion(slots.interaction[i]),
      'multi',
      quarterRoman
    );
  }

  // Doc title
  const core = zip.file('docProps/core.xml');
  if (core) {
    let xml = await core.async('string');
    xml = xml.replace(
      /<dc:title>[\s\S]*?<\/dc:title>/,
      `<dc:title>${escapeXml(`${districtCode} - проблематика в ${quarterCode}`)}</dc:title>`
    );
    zip.file('docProps/core.xml', xml);
  }

  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

export async function downloadAnalyticsPptx(opts) {
  const bytes = await buildAnalyticsPptxBuffer(opts);
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = opts.filename || analyticsPptxFilename(opts.districtCode);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
