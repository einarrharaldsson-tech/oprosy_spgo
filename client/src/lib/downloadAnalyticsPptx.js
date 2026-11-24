import JSZip from 'jszip';
import { isOtherOptionText } from './options';
import { buildQuestionCharts, isChoiceQuestion } from './surveyAnalytics';
import templateUrl from '../assets/report/problematika-template.pptx?url';
import gerbUrl from '../assets/report/spgo-gerb.png';

export const DISTRICT_FULL = 'Сергиево - Посадский городской округ';
export const DISTRICT_CODE = 'СПГО';

/** Only this survey gets the municipal problematika PPTX button. */
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

function slicesToRows(slices, { dropZero = true, otherLast = true, sortByShare = true } = {}) {
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
  if (!sortByShare) return rows;
  if (otherLast) {
    const other = rows.filter((r) => r.isOther);
    const rest = rows.filter((r) => !r.isOther).sort((a, b) => b.share - a.share);
    rows = [...rest, ...other];
  } else {
    rows = rows.sort((a, b) => b.share - a.share);
  }
  return rows;
}

function chartRowsFromQuestion(chart, opts = {}) {
  if (!chart) return [];
  return slicesToRows(chart.slices || [], opts);
}

function normLabel(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, ' ')
    .trim();
}

function labelsMatch(a, b) {
  const x = normLabel(a);
  const y = normLabel(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

/**
 * Map survey choice questions → PPTX chart slots.
 * For the November problematika questionnaire, match by known stems
 * (real wording differs from generic heuristics).
 */
export function mapSurveyToPptxSlots(survey, items) {
  const charts = buildQuestionCharts(survey?.questions || [], items);
  const byId = new Map(charts.map((c) => [Number(c.questionId), c]));
  const questions = (survey?.questions || []).filter(isChoiceQuestion);

  const take = (pred) => {
    const q = questions.find((question) => pred(String(question.text || ''), question));
    return q ? byId.get(Number(q.id)) : null;
  };

  // Real problematika stems (survey id 12+ copies).
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

  // Sphere satisfaction: «Вы удовлетворены … в сфере X» (not «Что Вас не устраивает»).
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

function buildStrPts(labels) {
  return labels
    .map((label, idx) => `<c:pt idx="${idx}"><c:v>${escapeXml(label)}</c:v></c:pt>`)
    .join('');
}

function buildNumPts(values) {
  return values
    .map((v, idx) => `<c:pt idx="${idx}"><c:v>${Number(v)}</c:v></c:pt>`)
    .join('');
}

/** Literal category/values — viewers cannot fall back to stale Excel/cache. */
function buildCatLit(labels) {
  return `<c:cat><c:strLit><c:ptCount val="${labels.length}"/>${buildStrPts(labels)}</c:strLit></c:cat>`;
}

function buildValLit(values, formatCode = '0%') {
  return `<c:val><c:numLit><c:formatCode>${formatCode}</c:formatCode><c:ptCount val="${values.length}"/>${buildNumPts(values)}</c:numLit></c:val>`;
}

function buildTxLit(title) {
  return `<c:tx><c:strLit><c:ptCount val="1"/><c:pt idx="0"><c:v>${escapeXml(title || 'Ряд 1')}</c:v></c:pt></c:strLit></c:tx>`;
}

/** Patch single-series chart with embedded literal data (ignore Excel). */
function patchSingleSeriesChart(xml, labels, values, seriesTitle = '') {
  let out = xml;
  out = out.replace(/<c:tx>[\s\S]*?<\/c:tx>/, buildTxLit(seriesTitle || 'Ряд 1'));
  out = out.replace(/<c:cat>[\s\S]*?<\/c:cat>/, buildCatLit(labels));
  out = out.replace(/<c:val>[\s\S]*?<\/c:val>/, buildValLit(values));
  return out;
}

function readPngSize(bytes) {
  if (!bytes || bytes.length < 24) return null;
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // PNG signature + IHDR
  if (u8[0] !== 0x89 || u8[1] !== 0x50) return null;
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** Center-crop srcRect so stretched fill keeps correct aspect ratio in the slot. */
function srcRectForSlot(imgW, imgH, slotCx, slotCy) {
  if (!imgW || !imgH || !slotCx || !slotCy) return { l: 0, t: 0, r: 0, b: 0 };
  const imgAr = imgW / imgH;
  const slotAr = slotCx / slotCy;
  const pct = (x) => Math.max(0, Math.min(50000, Math.round(x * 100000)));
  if (imgAr > slotAr) {
    const visible = imgH * slotAr;
    const side = (imgW - visible) / imgW / 2;
    return { l: pct(side), t: 0, r: pct(side), b: 0 };
  }
  const visible = imgW / slotAr;
  const side = (imgH - visible) / imgH / 2;
  return { l: 0, t: pct(side), r: 0, b: pct(side) };
}

function applyMapSrcRects(slideXml, imgSize) {
  if (!imgSize?.width || !imgSize?.height) return slideXml;
  return slideXml.replace(/<p:pic>[\s\S]*?<\/p:pic>/g, (pic) => {
    const name = pic.match(/<p:cNvPr[^>]*name="([^"]+)"/)?.[1] || '';
    if (/герб/i.test(name)) return pic;
    const ext = pic.match(/<a:ext[^>]*cx="(\d+)"[^>]*cy="(\d+)"/);
    if (!ext) return pic;
    const rect = srcRectForSlot(
      imgSize.width,
      imgSize.height,
      Number(ext[1]),
      Number(ext[2])
    );
    const srcRect = `<a:srcRect l="${rect.l}" t="${rect.t}" r="${rect.r}" b="${rect.b}"/>`;
    if (/<a:srcRect\b/.test(pic)) {
      return pic.replace(/<a:srcRect\b[^/]*\/>/, srcRect);
    }
    // Prefer after blip, before stretch/fillRect
    if (/<a:blip\b[^/]*\/>/.test(pic)) {
      return pic.replace(/(<a:blip\b[^/]*\/>)/, `$1${srcRect}`);
    }
    if (/<a:blip\b[\s\S]*?<\/a:blip>/.test(pic)) {
      return pic.replace(/(<\/a:blip>)/, `$1${srcRect}`);
    }
    return pic;
  });
}

/** Align survey rows to existing series titles in the template chart. */
function alignRowsToSeries(xml, seriesRows) {
  const titles = [...xml.matchAll(/<c:ser>[\s\S]*?<c:tx>[\s\S]*?<c:v>([^<]*)<\/c:v>/g)].map(
    (m) => m[1]
  );
  if (!titles.length) return seriesRows;
  const used = new Set();
  return titles.map((title) => {
    const idx = seriesRows.findIndex((r, i) => !used.has(i) && labelsMatch(r.label, title));
    if (idx >= 0) {
      used.add(idx);
      return seriesRows[idx];
    }
    return { label: title, share: 0, count: 0 };
  });
}

function patchMultiSeriesChart(xml, seriesRows, categoryLabel) {
  let out = xml;
  const aligned = alignRowsToSeries(out, seriesRows);
  const serBlocks = [...out.matchAll(/<c:ser>[\s\S]*?<\/c:ser>/g)].map((m) => m[0]);
  if (!serBlocks.length) return out;

  for (let i = 0; i < serBlocks.length; i += 1) {
    const block = serBlocks[i];
    const row = aligned[i];
    const share = row ? Number(row.share) : 0;
    const label = row?.label || `Ряд ${i + 1}`;
    let next = block;
    next = next.replace(/<c:tx>[\s\S]*?<\/c:tx>/, buildTxLit(label));
    next = next.replace(/<c:cat>[\s\S]*?<\/c:cat>/, buildCatLit([categoryLabel || '']));
    next = next.replace(/<c:val>[\s\S]*?<\/c:val>/, buildValLit([share]));
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

function colLetter(index0) {
  let n = index0;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

function buildSstXml(strings) {
  const items = strings
    .map((t) => {
      const text = String(t ?? '');
      const needsSpace = text !== text.trim() || text === '';
      const attrs = needsSpace ? ' xml:space="preserve"' : '';
      return `<si><t${attrs}>${escapeXml(text || ' ')}</t></si>`;
    })
    .join('');
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">` +
    `${items}</sst>`
  );
}

function styleAttrFromSample(sheetXml, preferNumeric = true) {
  if (preferNumeric) {
    const m = sheetXml.match(/<c r="B\d+" s="(\d+)"/);
    if (m) return ` s="${m[1]}"`;
  }
  return '';
}

/** PowerPoint redraws charts from embedded xlsx — caches alone are not enough. */
async function patchChartEmbedding(pptxZip, chartFile, payload) {
  const relsPath = `ppt/charts/_rels/${chartFile}.rels`;
  const rels = await readText(pptxZip, relsPath);
  if (!rels) return;
  const embName = rels.match(/Target="\.\.\/embeddings\/([^"]+)"/)?.[1];
  if (!embName) return;
  const embPath = `ppt/embeddings/${embName}`;
  const embFile = pptxZip.file(embPath);
  if (!embFile) return;

  const xlsx = await JSZip.loadAsync(await embFile.async('uint8array'));
  const sheetPath = 'xl/worksheets/sheet1.xml';
  const sheetXml = (await xlsx.file(sheetPath)?.async('string')) || '';
  if (!sheetXml) return;

  const numStyle = styleAttrFromSample(sheetXml, true);
  let strings;
  let sheetData;
  let tableRef;

  if (payload.mode === 'multi') {
    const series = payload.seriesRows || [];
    const cat = payload.categoryLabel || '';
    strings = [' ', ...series.map((r) => r.label)];
    const headerCells = [
      `<c r="A1" t="s"><v>0</v></c>`,
      ...series.map(
        (_, i) => `<c r="${colLetter(i + 1)}1" t="s"><v>${i + 1}</v></c>`
      ),
    ].join('');
    const valueCells = [
      `<c r="A2" t="s"><v>${strings.length}</v></c>`,
      ...series.map(
        (r, i) =>
          `<c r="${colLetter(i + 1)}2"${numStyle}><v>${Number(r.share)}</v></c>`
      ),
    ].join('');
    // category label is last shared string
    strings.push(cat);
    const lastCol = colLetter(series.length);
    tableRef = `A1:${lastCol}2`;
    sheetData =
      `<sheetData>` +
      `<row r="1" spans="1:${series.length + 1}">${headerCells}</row>` +
      `<row r="2" spans="1:${series.length + 1}">${valueCells}</row>` +
      `</sheetData>`;
  } else {
    const labels = payload.labels || [];
    const values = payload.values || [];
    const title = payload.seriesTitle || 'Ряд 1';
    strings = [' ', title, ...labels];
    const rowsXml = [
      `<row r="1" spans="1:2"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>`,
      ...labels.map(
        (label, i) =>
          `<row r="${i + 2}" spans="1:2">` +
          `<c r="A${i + 2}" t="s"><v>${i + 2}</v></c>` +
          `<c r="B${i + 2}"${numStyle}><v>${Number(values[i] ?? 0)}</v></c>` +
          `</row>`
      ),
    ].join('');
    tableRef = `A1:B${labels.length + 1}`;
    sheetData = `<sheetData>${rowsXml}</sheetData>`;
  }

  let nextSheet = sheetXml.replace(/<sheetData>[\s\S]*?<\/sheetData>/, sheetData);
  nextSheet = nextSheet.replace(
    /<dimension[^/]*\/>/,
    `<dimension ref="${tableRef}"/>`
  );
  xlsx.file(sheetPath, nextSheet);
  xlsx.file('xl/sharedStrings.xml', buildSstXml(strings));

  const tableFile = xlsx.file('xl/tables/table1.xml');
  if (tableFile) {
    let tableXml = await tableFile.async('string');
    tableXml = tableXml.replace(/ref="[^"]+"/, `ref="${tableRef}"`);
    tableXml = tableXml.replace(
      /(<autoFilter[^>]*ref=")[^"]+(")/,
      `$1${tableRef}$2`
    );
    // Keep 2-column table headers in sync for single-series charts
    if (payload.mode !== 'multi') {
      const title = escapeXml(payload.seriesTitle || 'Ряд 1');
      tableXml = tableXml.replace(
        /(<tableColumn id="2"[^>]*name=")[^"]*(")/,
        `$1${title}$2`
      );
    }
    xlsx.file('xl/tables/table1.xml', tableXml);
  }

  const out = await xlsx.generateAsync({ type: 'uint8array' });
  pptxZip.file(embPath, out);
}

/** Prefer template gender order so slice colors stay consistent. */
function orderGenderRows(rows) {
  if (!rows?.length) return rows;
  const male = rows.find((r) => /муж/i.test(r.label));
  const female = rows.find((r) => /жен/i.test(r.label));
  if (!male || !female) return rows;
  const rest = rows.filter((r) => r !== male && r !== female);
  return [male, female, ...rest];
}

async function applyChart(zip, chartFile, rows, mode, categoryLabel, seriesTitle = '') {
  const path = `ppt/charts/${chartFile}`;
  const file = zip.file(path);
  if (!file) return;
  let xml = await file.async('string');
  const safeRows = rows?.length ? rows : [];
  if (mode === 'multi') {
    const aligned = alignRowsToSeries(xml, safeRows);
    xml = patchMultiSeriesChart(xml, safeRows, categoryLabel);
    await patchChartEmbedding(zip, chartFile, {
      mode: 'multi',
      seriesRows: aligned,
      categoryLabel,
    });
  } else if (!safeRows.length) {
    zip.file(path, xml);
    return;
  } else {
    const labels = rows.map((r) => r.label);
    const values = rows.map((r) => r.share);
    xml = patchSingleSeriesChart(xml, labels, values, seriesTitle);
    await patchChartEmbedding(zip, chartFile, {
      mode: 'single',
      labels,
      values,
      seriesTitle,
    });
  }
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
  const mapSize = overview ? readPngSize(overview) : null;
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

  // Clear leftover geo-comment / frame hints; crop map pics to slot aspect ratio
  for (const n of [2, 3, 4]) {
    await patchSlide(zip, n, (s) => {
      let out = clearAllMatchingText(s, [
        'Комментарий в случае проблем',
        'рамку после',
        'Общее фото карты',
        'Приближенное фото',
        'Фото карты территории',
      ]);
      out = applyMapSrcRects(out, mapSize);
      return out;
    });
  }

  // --- Charts ---
  await applyChart(
    zip,
    'chart1.xml',
    orderGenderRows(chartRowsFromQuestion(slots.gender, { sortByShare: false })),
    'single',
    null,
    'Пол'
  );
  await applyChart(
    zip,
    'chart2.xml',
    chartRowsFromQuestion(slots.age, { sortByShare: false }),
    'single',
    null,
    'Возраст'
  );
  await applyChart(zip, 'chart3.xml', chartRowsFromQuestion(slots.profession), 'single', null, 'Профиль');
  await applyChart(
    zip,
    'chart4.xml',
    chartRowsFromQuestion(slots.overall, { sortByShare: false }),
    'multi',
    quarterRoman
  );
  await applyChart(
    zip,
    'chart5.xml',
    chartRowsFromQuestion(slots.head, { sortByShare: false }),
    'multi',
    quarterRoman
  );

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
  if (!isProblematikaPptxSurvey(opts?.survey)) {
    throw new Error(
      `Презентация доступна только для опроса «${PROBLEMATIKA_PPTX_SURVEY_TITLE}»`
    );
  }
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
