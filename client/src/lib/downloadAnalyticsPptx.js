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

function roundShare(count, total) {
  if (!total) return 0;
  return Math.round((count / total) * 1000) / 1000;
}

function slicesToRows(slices, { dropZero = true, otherLast = true } = {}) {
  let rows = (slices || [])
    .filter((s) => s.id !== 'unanswered')
    .map((s) => {
      const percent =
        typeof s.percent === 'number' ? s.percent : roundShare(s.count, s._total || 0) * 100;
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
  const total = chart.totalSessions || 0;
  const enriched = (chart.slices || []).map((s) => ({ ...s, _total: total }));
  return slicesToRows(enriched);
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
    profession,
    industry,
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

/** Replace first cat strCache + first val numCache (single-series charts). */
function patchSingleSeriesChart(xml, labels, values) {
  let out = xml;
  const n = labels.length;
  out = out.replace(/<c:strCache>[\s\S]*?<\/c:strCache>/, buildStrCache(labels));
  out = out.replace(/<c:numCache>[\s\S]*?<\/c:numCache>/, buildNumCache(values));
  // Update sheet formulas to match length
  out = out.replace(/Лист1!\$A\$2:\$A\$\d+/g, `Лист1!$A$2:$A$${n + 1}`);
  out = out.replace(/Лист1!\$B\$2:\$B\$\d+/g, `Лист1!$B$2:$B$${n + 1}`);
  if (n === 1) {
    out = out.replace(/Лист1!\$A\$2:\$A\$\d+/g, 'Лист1!$A$2');
    out = out.replace(/Лист1!\$B\$2:\$B\$\d+/g, 'Лист1!$B$2');
  }
  return out;
}

/**
 * Multi-series charts (one category column, each series = one answer option).
 * Template chart5/6/11–14: each <c:ser> has series name + single value for quarter category.
 */
function patchMultiSeriesChart(xml, seriesRows, categoryLabel) {
  let out = xml;
  // Replace every series name cache (first c:v inside c:tx) and value
  const serBlocks = [...out.matchAll(/<c:ser>[\s\S]*?<\/c:ser>/g)].map((m) => m[0]);
  if (!serBlocks.length) return out;

  const count = Math.min(serBlocks.length, seriesRows.length);
  for (let i = 0; i < serBlocks.length; i += 1) {
    const block = serBlocks[i];
    if (i >= count) {
      // Zero-out unused series
      let next = block.replace(
        /(<c:tx>[\s\S]*?<c:strCache>[\s\S]*?<c:v>)([^<]*)(<\/c:v>)/,
        `$1${escapeXml(seriesRows[i]?.label || '.')}$3`
      );
      next = next.replace(
        /(<c:numCache>[\s\S]*?<c:v>)([^<]*)(<\/c:v>)/,
        '$10$3'
      );
      out = out.replace(block, next);
      continue;
    }
    const row = seriesRows[i];
    let next = block;
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

function replaceAllTextInSlide(xml, replacements) {
  let out = xml;
  for (const [from, to] of replacements) {
    if (!from) continue;
    out = out.split(from).join(escapeXml(to));
  }
  return out;
}

/** Turn instruction-red runs to black once content is filled. */
function recolorInstructions(xml) {
  return xml
    .replace(/<a:srgbClr val="C00000"\/>/gi, '<a:srgbClr val="000000"/>')
    .replace(/<a:srgbClr val="FF0000"\/>/gi, '<a:srgbClr val="000000"/>');
}

function nextShapeId(slideXml) {
  let max = 1;
  for (const m of slideXml.matchAll(/\bid="(\d+)"/g)) {
    max = Math.max(max, Number(m[1]) || 0);
  }
  return max + 1;
}

function nextRid(relsXml) {
  let max = 1;
  for (const m of relsXml.matchAll(/\bId="rId(\d+)"/g)) {
    max = Math.max(max, Number(m[1]) || 0);
  }
  return max + 1;
}

function findShapeBoxes(slideXml, pred) {
  const boxes = [];
  for (const m of slideXml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)) {
    const block = m[0];
    const texts = [...block.matchAll(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/g)].map((x) => x[1]).join('');
    if (!pred(texts, block)) continue;
    const off = block.match(/<a:off[^>]*x="(\d+)"[^>]*y="(\d+)"/);
    const ext = block.match(/<a:ext[^>]*cx="(\d+)"[^>]*cy="(\d+)"/);
    if (!off || !ext) continue;
    boxes.push({
      x: Number(off[1]),
      y: Number(off[2]),
      cx: Number(ext[1]),
      cy: Number(ext[2]),
      texts,
      block,
    });
  }
  return boxes;
}

function pictureXml({ id, name, rid, x, y, cx, cy }) {
  return `<p:pic>
  <p:nvPicPr>
    <p:cNvPr id="${id}" name="${escapeXml(name)}"/>
    <p:cNvPicPr><a:picLocks noChangeAspect="0"/></p:cNvPicPr>
    <p:nvPr/>
  </p:nvPicPr>
  <p:blipFill>
    <a:blip r:embed="rId${rid}"/>
    <a:stretch><a:fillRect/></a:stretch>
  </p:blipFill>
  <p:spPr>
    <a:xfrm>
      <a:off x="${x}" y="${y}"/>
      <a:ext cx="${cx}" cy="${cy}"/>
    </a:xfrm>
    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
  </p:spPr>
</p:pic>`;
}

function clearShapeText(block) {
  return block.replace(/<a:t(?:\s[^>]*)?>[^<]*<\/a:t>/g, '<a:t></a:t>');
}

async function fetchBinary(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Не удалось загрузить ресурс: ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

function contextLine({ districtFull, datesLabel, total }) {
  return `${districtFull}: ${datesLabel}, опрошено ${total}`;
}

async function readText(zip, path) {
  const file = zip.file(path);
  if (!file) return null;
  return file.async('string');
}

async function removeInstructionSlides(zip) {
  // Drop slides 2 and 6 (template says delete them).
  const dropFiles = ['ppt/slides/slide2.xml', 'ppt/slides/slide6.xml'];
  const relsPath = 'ppt/_rels/presentation.xml.rels';
  let rels = await readText(zip, relsPath);
  const ridToTarget = new Map();
  for (const m of rels.matchAll(
    /<Relationship[^>]*Id="(rId\d+)"[^>]*Target="([^"]+)"[^>]*\/>/g
  )) {
    ridToTarget.set(m[1], m[2]);
  }
  const dropRids = new Set();
  for (const [rid, target] of ridToTarget) {
    if (/slides\/slide2\.xml$/.test(target) || /slides\/slide6\.xml$/.test(target)) {
      dropRids.add(rid);
    }
  }
  rels = rels.replace(/<Relationship[^>]*\/>/g, (tag) => {
    const id = tag.match(/Id="(rId\d+)"/)?.[1];
    return id && dropRids.has(id) ? '' : tag;
  });
  zip.file(relsPath, rels);

  let pres = await readText(zip, 'ppt/presentation.xml');
  pres = pres.replace(/<p:sldId[^>]*\/>/g, (tag) => {
    const rid = tag.match(/r:id="(rId\d+)"/)?.[1];
    return rid && dropRids.has(rid) ? '' : tag;
  });
  zip.file('ppt/presentation.xml', pres);

  for (const f of dropFiles) zip.remove(f);
  zip.remove('ppt/slides/_rels/slide2.xml.rels');
  zip.remove('ppt/slides/_rels/slide6.xml.rels');
}

async function ensurePngContentType(zip) {
  const ctPath = '[Content_Types].xml';
  let ct = await readText(zip, ctPath);
  if (!/Extension="png"/i.test(ct)) {
    ct = ct.replace(
      '<Default Extension="jpeg"',
      '<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg"'
    );
  }
  zip.file(ctPath, ct);
}

function addMedia(zip, fileName, bytes) {
  const path = `ppt/media/${fileName}`;
  zip.file(path, bytes);
  return path;
}

async function attachPictureToSlide(zip, slideNum, { bytes, fileName, box, picName }) {
  const slidePath = `ppt/slides/slide${slideNum}.xml`;
  const relsPath = `ppt/slides/_rels/slide${slideNum}.xml.rels`;
  let slide = await readText(zip, slidePath);
  let rels =
    (await readText(zip, relsPath)) ||
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';

  const rid = nextRid(rels);
  const id = nextShapeId(slide);
  addMedia(zip, fileName, bytes);
  rels = rels.replace(
    '</Relationships>',
    `<Relationship Id="rId${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${fileName}"/></Relationships>`
  );
  const pic = pictureXml({
    id,
    name: picName || fileName,
    rid,
    x: box.x,
    y: box.y,
    cx: box.cx,
    cy: box.cy,
  });
  if (!slide.includes('</p:spTree>')) {
    throw new Error(`Слайд ${slideNum}: нет spTree`);
  }
  slide = slide.replace('</p:spTree>', `${pic}</p:spTree>`);
  zip.file(slidePath, slide);
  zip.file(relsPath, rels);
}

function blankInstructionBoxes(slideXml, patterns) {
  let out = slideXml;
  for (const box of findShapeBoxes(out, (text) => patterns.some((re) => re.test(text)))) {
    out = out.replace(box.block, clearShapeText(box.block));
  }
  return out;
}

async function applyChartFromRows(zip, chartFile, rows, mode, categoryLabel) {
  const path = `ppt/charts/${chartFile}`;
  const file = zip.file(path);
  if (!file) return;
  let xml = await file.async('string');
  if (!rows?.length) {
    zip.file(path, xml);
    return;
  }
  if (mode === 'multi') {
    xml = patchMultiSeriesChart(xml, rows, categoryLabel);
  } else {
    xml = patchSingleSeriesChart(
      xml,
      rows.map((r) => r.label),
      rows.map((r) => r.share)
    );
  }
  zip.file(path, xml);
}

function fillProblemTablePercents(slideXml, rows, maxSlots = 10) {
  // Replace standalone "%" text runs sequentially with formatted percents.
  const percents = rows.slice(0, maxSlots).map((r) => `${Math.round(r.share * 1000) / 10}%`);
  let i = 0;
  return slideXml.replace(/<a:t(?:\s[^>]*)?>%<\/a:t>/g, (m) => {
    if (i >= percents.length) return '<a:t></a:t>';
    const v = percents[i];
    i += 1;
    return `<a:t>${escapeXml(v)}</a:t>`;
  });
}

/**
 * Build municipal problematika PPTX from the official template.
 * mapImages (optional):
 *   {
 *     overview?: Uint8Array|ArrayBuffer|Blob,          // large map for geo slides
 *     zooms?: Array<Uint8Array|ArrayBuffer|Blob>,      // close-ups
 *     overviewAlt?: ..., overviewAlt2?: ...            // for variants 4/5
 *   }
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
  const datesLabel = monthYear;
  const ctx = contextLine({ districtFull, datesLabel, total });
  const slots = mapSurveyToPptxSlots(survey, items);

  const templateBytes = templateBytesOpt || (await fetchBinary(templateUrl));
  const gerbBytes = gerbBytesOpt || (await fetchBinary(gerbUrl));
  const zip = await JSZip.loadAsync(templateBytes);
  await ensurePngContentType(zip);
  await removeInstructionSlides(zip);

  const toBytes = async (img) => {
    if (!img) return null;
    if (img instanceof Uint8Array) return img;
    if (img instanceof ArrayBuffer) return new Uint8Array(img);
    if (typeof Blob !== 'undefined' && img instanceof Blob) {
      return new Uint8Array(await img.arrayBuffer());
    }
    return null;
  };

  const overview = (await toBytes(mapImages.overview)) || null;
  const zooms = [];
  for (const z of mapImages.zooms || []) {
    const b = await toBytes(z);
    if (b) zooms.push(b);
  }
  const overview2 = (await toBytes(mapImages.overviewAlt)) || overview;
  const overview3 = (await toBytes(mapImages.overviewAlt2)) || overview;

  // --- Title slide ---
  {
    let s = await readText(zip, 'ppt/slides/slide1.xml');
    s = replaceAllTextInSlide(s, [
      ['Наименование муниципального образования', districtFull],
      ['Исследование проблематики, ноябрь 2026 года', `Исследование проблематики, ${monthYear}`],
      ['герб во всю высоту слайда', ''],
      ['герб на 2/3 ширины', ''],
      ['Можно вставить в эту рамку', ''],
      ['(рамку после вставки герба удалить)', ''],
    ]);
    // Large gerb area on title: right side heuristic box from instructions (~2/3 height)
    const gerbBoxes = findShapeBoxes(s, (t) => /герб/i.test(t) || /рамку после вставки герба/i.test(t));
    for (const box of gerbBoxes) s = s.replace(box.block, clearShapeText(box.block));
    s = recolorInstructions(s);
    zip.file('ppt/slides/slide1.xml', s);
    // Place gerb on the right half of the title slide
    await attachPictureToSlide(zip, 1, {
      bytes: gerbBytes,
      fileName: 'spgo-gerb-title.png',
      box: { x: 7200000, y: 900000, cx: 4200000, cy: 5200000 },
      picName: 'Герб СПГО',
    });
  }

  const subtitleReplacements = (slideXml) => {
    let s = slideXml;
    s = s.replace(
      /\(округ: территории, на которых проводилось исследование, даты и количество опрошенных\)/g,
      `(${escapeXml(ctx)})`
    );
    s = s.replace(
      /\(\s*округ: территории, на которых проводилось исследование, даты и количество опрошенных\)/g,
      `(${escapeXml(ctx)})`
    );
    return s;
  };

  // --- Geography slides 3,4,5 (all required) ---
  const geoSpecs = [
    {
      slide: 3,
      overview,
      zoomCount: 4,
      overviewBoxes: (t) => /Общее фото карты/i.test(t),
      zoomBoxes: (t) => /Приближенное фото/i.test(t),
    },
    {
      slide: 4,
      overview: overview2,
      zoomCount: 1,
      overviewBoxes: (t) => /Фото карты территории исследования 1/i.test(t),
      zoomBoxes: (t) => /Фото карты территории исследования 2/i.test(t),
    },
    {
      slide: 5,
      overview: overview3,
      zoomCount: 2,
      overviewBoxes: (t) => /Фото карты территории исследования 1/i.test(t),
      zoomBoxes: (t) => /Фото карты территории исследования [23]/i.test(t),
    },
  ];

  for (const spec of geoSpecs) {
    let s = await readText(zip, `ppt/slides/slide${spec.slide}.xml`);
    s = subtitleReplacements(s);
    s = s.replace(
      /Комментарий в случае проблем с\s*геолокацией[\s\S]*?удалить это поле/g,
      ''
    );
    // Clear geo comment box text
    s = blankInstructionBoxes(s, [/Комментарий в случае проблем/i, /рамку после/i, /фото карты/i, /Приближенное фото/i]);
    // Clear gerb placeholder text
    for (const box of findShapeBoxes(s, (t) => /^Герб$/i.test(t.trim()))) {
      s = s.replace(box.block, clearShapeText(box.block));
    }
    s = recolorInstructions(s);
    zip.file(`ppt/slides/slide${spec.slide}.xml`, s);

    // gerb
    const gerbBox = findShapeBoxes(
      await readText(zip, `ppt/slides/slide${spec.slide}.xml`),
      (t) => t.trim() === '' || /^Герб$/i.test(t.trim())
    );
    // Use fixed gerb slot from template analysis
    await attachPictureToSlide(zip, spec.slide, {
      bytes: gerbBytes,
      fileName: `spgo-gerb-s${spec.slide}.png`,
      box: { x: 292097, y: 160339, cx: 587399, cy: 691600 },
      picName: 'Герб',
    });

    if (spec.overview) {
      const boxes = findShapeBoxes(
        await readText(zip, `ppt/slides/slide${spec.slide}.xml`),
        spec.overviewBoxes
      );
      // After clearing, text may be empty — use positional fallbacks per slide
      const overviewBox =
        boxes[0] ||
        (spec.slide === 3
          ? { x: 393700, y: 1136101, cx: 5168900, cy: 5037688 }
          : spec.slide === 4
            ? { x: 393700, y: 1136101, cx: 5500000, cy: 5000000 }
            : { x: 393700, y: 1136101, cx: 5500000, cy: 5000000 });
      await attachPictureToSlide(zip, spec.slide, {
        bytes: spec.overview,
        fileName: `map-overview-s${spec.slide}.png`,
        box: overviewBox,
        picName: 'Карта',
      });
    }

    const zoomBoxesFallback =
      spec.slide === 3
        ? [
            { x: 5748337, y: 1136101, cx: 2921000, cy: 2417304 },
            { x: 8793162, y: 1136101, cx: 2921000, cy: 2417304 },
            { x: 5748337, y: 3756485, cx: 2921000, cy: 2417304 },
            { x: 8793162, y: 3756485, cx: 2921000, cy: 2417304 },
          ]
        : spec.slide === 4
          ? [{ x: 6500000, y: 1136101, cx: 5000000, cy: 5000000 }]
          : [
              { x: 6500000, y: 1136101, cx: 5000000, cy: 2400000 },
              { x: 6500000, y: 3700000, cx: 5000000, cy: 2400000 },
            ];

    for (let i = 0; i < spec.zoomCount; i += 1) {
      const img = zooms[i] || zooms[0] || spec.overview;
      if (!img) continue;
      await attachPictureToSlide(zip, spec.slide, {
        bytes: img,
        fileName: `map-zoom-s${spec.slide}-${i + 1}.png`,
        box: zoomBoxesFallback[i] || zoomBoxesFallback[0],
        picName: `Карта крупно ${i + 1}`,
      });
    }
  }

  // Helper: gerb + subtitle on content slides
  const prepareContentSlide = async (slideNum, extra) => {
    let s = await readText(zip, `ppt/slides/slide${slideNum}.xml`);
    s = subtitleReplacements(s);
    for (const box of findShapeBoxes(s, (t) => /^Герб$/i.test(t.trim()))) {
      s = s.replace(box.block, clearShapeText(box.block));
    }
    if (extra) s = extra(s);
    s = recolorInstructions(s);
    zip.file(`ppt/slides/slide${slideNum}.xml`, s);
    await attachPictureToSlide(zip, slideNum, {
      bytes: gerbBytes,
      fileName: `spgo-gerb-s${slideNum}.png`,
      box: { x: 292097, y: 160339, cx: 587399, cy: 691600 },
      picName: 'Герб',
    });
  };

  // Slide 7 — gender + age
  await prepareContentSlide(7, (s) =>
    blankInstructionBoxes(s, [/Заполняется в порядке/i, /Если 0%/i, /«Другое» всегда/i])
  );
  await applyChartFromRows(zip, 'chart1.xml', chartRowsFromQuestion(slots.gender), 'single');
  await applyChartFromRows(zip, 'chart2.xml', chartRowsFromQuestion(slots.age), 'single');

  // Slide 8 — profession + industry
  await prepareContentSlide(8, (s) =>
    blankInstructionBoxes(s, [/Заполняется в порядке/i, /Если 0%/i, /«Другое» всегда/i])
  );
  await applyChartFromRows(zip, 'chart3.xml', chartRowsFromQuestion(slots.profession), 'single');
  await applyChartFromRows(zip, 'chart4.xml', chartRowsFromQuestion(slots.industry), 'single');

  // Slide 9 — overall + head
  await prepareContentSlide(9, (s) => {
    let out = blankInstructionBoxes(s, [
      /Заполняется в порядке/i,
      /Вносится столько/i,
      /«Другое» всегда/i,
    ]);
    const problemRows = chartRowsFromQuestion(slots.overall);
    out = fillProblemTablePercents(out, problemRows, 11);
    return out;
  });
  await applyChartFromRows(
    zip,
    'chart5.xml',
    chartRowsFromQuestion(slots.overall),
    'multi',
    quarterRoman
  );
  await applyChartFromRows(
    zip,
    'chart6.xml',
    chartRowsFromQuestion(slots.head),
    'multi',
    quarterRoman
  );

  // Slides 10–12 — spheres (keep all 3 template slides; fill what we can)
  for (let i = 0; i < 3; i += 1) {
    const slideNum = 10 + i;
    const chartFile = `chart${7 + i}.xml`;
    const sphere = slots.spheres[i];
    await prepareContentSlide(slideNum, (s) => {
      let out = s;
      const title = sphere?.questionText
        ? String(sphere.questionText).trim().slice(0, 80)
        : 'НАЗВАНИЕ';
      out = out.split('НАЗВАНИЕ').join(escapeXml(title));
      out = blankInstructionBoxes(out, [
        /Аналогичный делается/i,
        /Если для анализа/i,
        /Заполняется в порядке/i,
        /Если 0%/i,
        /«Другое» всегда/i,
        /Баланс =/i,
        /варианты\s*при наличии/i,
      ]);
      const rows = chartRowsFromQuestion(sphere);
      out = fillProblemTablePercents(out, rows, 16);

      // Balance = satisfied% - unsatisfied%
      const sat = rows.find((r) => /удовлетворен/i.test(r.label) && !/не\s+удовлетворен/i.test(r.label));
      const unsat = rows.find((r) => /не\s+удовлетворен/i.test(r.label));
      const balance =
        sat && unsat ? Math.round((sat.share - unsat.share) * 1000) / 10 : null;
      if (balance != null) {
        out = out.replace(/Х%/g, `${balance}%`);
        out = out.replace(/Баланс оценок в сфере:\s*/g, `Баланс оценок в сфере: `);
      }

      const otherTexts = (sphere?.slices || [])
        .filter((sl) => isOtherOptionText(sl.label))
        .flatMap((sl) => sl.otherTexts || []);
      if (otherTexts.length) {
        out = out.replace(
          /Другое\s*:\s*/g,
          `Другое: ${escapeXml(otherTexts.slice(0, 12).join('; '))}`
        );
      } else {
        out = out.replace(/Другое\s*:[\s\S]{0,120}?поле удаляется[\s\S]{0,80}?\)/g, '');
      }
      return out;
    });
    await applyChartFromRows(zip, chartFile, chartRowsFromQuestion(sphere), 'single');
  }

  // Slide 13 — sources
  await prepareContentSlide(13, (s) =>
    blankInstructionBoxes(s, [/Заполняется в порядке/i, /Если 0%/i, /«Другое» всегда/i])
  );
  await applyChartFromRows(zip, 'chart10.xml', chartRowsFromQuestion(slots.sources), 'single');

  // Slide 14 — interaction (up to 4 charts)
  await prepareContentSlide(14);
  const interactionCharts = ['chart11.xml', 'chart12.xml', 'chart13.xml', 'chart14.xml'];
  for (let idx = 0; idx < interactionCharts.length; idx += 1) {
    await applyChartFromRows(
      zip,
      interactionCharts[idx],
      chartRowsFromQuestion(slots.interaction[idx]),
      'multi',
      quarterRoman
    );
  }

  // Renumber visible slide numbers roughly (optional cosmetic)
  const remaining = [1, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14];
  for (let idx = 0; idx < remaining.length; idx += 1) {
    const slideNum = remaining[idx];
    const path = `ppt/slides/slide${slideNum}.xml`;
    let s = await readText(zip, path);
    // Only replace the slide-number shape if it's a lone number matching old index
    s = s.replace(
      new RegExp(`(<a:t(?:\\s[^>]*)?>)${slideNum}(</a:t>)`),
      `$1${idx + 1}$2`
    );
    zip.file(path, s);
  }

  // doc props
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
