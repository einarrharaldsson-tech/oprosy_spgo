import gerbUrl from '../assets/report/spgo-gerb.png';
import { piePath, CHART_COLORS } from './surveyAnalytics';
import {
  DISTRICT_CODE,
  DISTRICT_FULL,
  isProblematikaPptxSurvey,
  mapSurveyToPptxSlots,
  quarterParts,
} from './problematikaReport';

export { isProblematikaPptxSurvey };

export function analyticsHtmlFilename(district = DISTRICT_CODE, date = new Date()) {
  return `${district} - проблематика в ${quarterParts(date).quarterCode}.html`;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pct(shareOrPercent, alreadyPercent = false) {
  const p = alreadyPercent ? Number(shareOrPercent) : Number(shareOrPercent) * 100;
  if (!Number.isFinite(p)) return '0%';
  const rounded = Math.round(p * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
}

function rowsFromChart(chart, { sortByShare = true } = {}) {
  if (!chart?.slices?.length) return [];
  let rows = chart.slices
    .filter((s) => s.id !== 'unanswered' && (s.count > 0 || s.percent > 0))
    .map((s, i) => ({
      label: String(s.label || 'Вариант').trim() || 'Вариант',
      percent: typeof s.percent === 'number' ? s.percent : 0,
      count: s.count || 0,
      color: s.color || CHART_COLORS[i % CHART_COLORS.length],
    }));
  if (sortByShare) rows = [...rows].sort((a, b) => b.percent - a.percent);
  return rows;
}

function orderGender(rows) {
  const male = rows.find((r) => /муж/i.test(r.label));
  const female = rows.find((r) => /жен/i.test(r.label));
  if (!male || !female) return rows;
  return [male, female, ...rows.filter((r) => r !== male && r !== female)];
}

function svgPie(rows, size = 280) {
  const total = rows.reduce((s, r) => s + r.count, 0) || rows.reduce((s, r) => s + r.percent, 0);
  if (!total || !rows.length) {
    return `<p class="muted">Нет данных</p>`;
  }
  const cx = 100;
  const cy = 100;
  const radius = 92;
  let cursor = 0;
  const arcs = rows.map((row) => {
    const weight = row.count > 0 ? row.count : row.percent;
    const sweep = (weight / total) * 360;
    const start = cursor;
    const end = cursor + sweep;
    cursor = end;
    return { ...row, start, end, fullCircle: rows.length === 1 && sweep >= 359.99 };
  });
  const paths = arcs
    .map((slice) =>
      slice.fullCircle
        ? `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${escapeHtml(slice.color)}"/>`
        : `<path d="${piePath(cx, cy, radius, slice.start, slice.end)}" fill="${escapeHtml(slice.color)}"/>`
    )
    .join('');
  return `<svg class="pie" viewBox="0 0 200 200" width="${size}" height="${size}" role="img">${paths}</svg>`;
}

function legend(rows) {
  return `<ul class="legend">${rows
    .map(
      (r) =>
        `<li><svg class="swatch" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">` +
        `<rect x="0" y="0" width="14" height="14" rx="3" fill="${escapeHtml(r.color)}"/></svg>` +
        `<span class="lab">${escapeHtml(r.label)}</span>` +
        `<span class="val">${pct(r.percent, true)}</span></li>`
    )
    .join('')}</ul>`;
}

function barList(rows) {
  if (!rows.length) return `<p class="muted">Нет данных</p>`;
  // SVG bars survive PDF print even when browser "background graphics" is off.
  return `<div class="bars">${rows
    .map((r) => {
      const w = Math.max(0, Math.min(100, r.percent));
      const fillW = Math.max(w > 0 ? 1.2 : 0, w);
      return (
        `<div class="bar-row">` +
        `<div class="bar-lab">${escapeHtml(r.label)}</div>` +
        `<svg class="bar-svg" viewBox="0 0 100 10" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(pct(r.percent, true))}">` +
        `<rect class="bar-track-svg" x="0" y="1.5" width="100" height="7" rx="3.5" fill="#e7eeee"/>` +
        (fillW > 0
          ? `<rect class="bar-fill-svg" x="0" y="1.5" width="${fillW}" height="7" rx="3.5" fill="${escapeHtml(r.color)}"/>`
          : '') +
        `</svg>` +
        `<div class="bar-val">${pct(r.percent, true)}</div>` +
        `</div>`
      );
    })
    .join('')}</div>`;
}

function slide(num, title, body, ctx) {
  return (
    `<section class="slide" data-slide="${num}">` +
    `<div class="slide-scale">` +
    `<header class="slide-head">` +
    `<div class="slide-num">${num}</div>` +
    `<div class="slide-titles"><h2>${escapeHtml(title)}</h2>` +
    (ctx ? `<p class="ctx">${escapeHtml(ctx)}</p>` : '') +
    `</div></header>` +
    `<div class="slide-body">${body}</div>` +
    `</div></section>`
  );
}

async function toDataUrl(blobOrUrl) {
  if (!blobOrUrl) return '';
  if (typeof blobOrUrl === 'string' && blobOrUrl.startsWith('data:')) return blobOrUrl;
  if (typeof Blob !== 'undefined' && blobOrUrl instanceof Blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Не удалось прочитать изображение'));
      reader.readAsDataURL(blobOrUrl);
    });
  }
  const res = await fetch(blobOrUrl);
  if (!res.ok) return '';
  const blob = await res.blob();
  return toDataUrl(blob);
}

function buildCss() {
  return `
:root {
  --brand: #0f3d3e;
  --accent: #c45c26;
  --ink: #1a2424;
  --muted: #5a6a6a;
  --line: #d5e0e0;
  --bg: #f3f6f6;
  --paper: #ffffff;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--bg); color: var(--ink);
  font-family: "Manrope", "Segoe UI", system-ui, sans-serif; }
.deck { max-width: 1100px; margin: 0 auto; padding: 24px 16px 64px; }
.slide {
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 28px 32px 36px;
  margin: 0 0 28px;
  min-height: 640px;
  box-shadow: 0 8px 28px rgba(15,61,62,0.06);
  overflow: hidden;
}
.slide-scale {
  transform-origin: top left;
  width: 100%;
}
.slide-head { display: flex; gap: 16px; align-items: flex-start; margin-bottom: 22px;
  border-bottom: 2px solid var(--brand); padding-bottom: 14px; }
.slide-num {
  flex: 0 0 auto; width: 42px; height: 42px; border-radius: 10px;
  background: var(--brand); color: #fff; display: grid; place-items: center;
  font-weight: 700; font-size: 1.1rem;
}
.slide-titles h2 { margin: 0 0 6px; font-size: 1.35rem; line-height: 1.25; color: var(--brand); }
.ctx { margin: 0; color: var(--muted); font-size: 0.92rem; }
.slide-body { display: grid; gap: 20px; }
.title-slide { min-height: 700px; display: grid; grid-template-rows: auto 1fr auto; }
.title-hero { display: grid; place-items: center; text-align: center; gap: 18px; padding: 40px 12px; }
.title-hero img.gerb { width: 160px; height: auto; }
.title-hero h1 { margin: 0; font-size: 2rem; color: var(--brand); line-height: 1.2; }
.title-hero .period { font-size: 1.2rem; color: var(--muted); }
.geo-grid { display: grid; gap: 12px; }
.geo-grid img { width: 100%; height: auto; max-height: 520px; object-fit: contain; border-radius: 8px; border: 1px solid var(--line); background: #fff; }
.split-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; align-items: start; }
.chart-block h3 { margin: 0 0 12px; font-size: 1.05rem; color: var(--brand); }
.pie-wrap { display: grid; grid-template-columns: auto minmax(160px, max-content); gap: 18px; align-items: center; justify-content: start; }
.legend { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; width: max-content; max-width: 320px; }
.legend li { display: grid; grid-template-columns: 14px max-content auto; gap: 10px 12px; align-items: center; font-size: 0.95rem; }
.swatch { width: 14px; height: 14px; display: block; flex: 0 0 auto; }
.val { font-weight: 700; color: var(--brand); }
.bars { display: grid; gap: 10px; }
.bar-row { display: grid; grid-template-columns: minmax(120px, 34%) 1fr 56px; gap: 10px; align-items: center; }
.bar-lab { font-size: 0.9rem; line-height: 1.25; }
.bar-svg { width: 100%; height: 14px; display: block; overflow: visible; }
.bar-val { text-align: right; font-weight: 700; color: var(--brand); font-size: 0.9rem; }
.pie, .bar-svg, .swatch, .slide-num {
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
  color-adjust: exact;
}
.muted { color: var(--muted); }
.note { font-size: 0.85rem; color: var(--muted); }
.toolbar-print {
  position: sticky; top: 0; z-index: 5; background: rgba(243,246,246,0.95);
  backdrop-filter: blur(6px); border-bottom: 1px solid var(--line);
  padding: 10px 16px; display: flex; gap: 12px; align-items: center; justify-content: center;
  flex-wrap: wrap;
}
.toolbar-print button {
  appearance: none; border: 0; background: var(--brand); color: #fff;
  border-radius: 8px; padding: 10px 16px; font: inherit; font-weight: 600; cursor: pointer;
}
@page {
  size: A4 landscape;
  margin: 0;
}
@media print {
  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    color-adjust: exact !important;
  }
  .toolbar-print { display: none !important; }
  html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
  .deck { max-width: none; width: 100%; margin: 0; padding: 0; }
  .slide {
    box-shadow: none !important;
    border: 0 !important;
    border-radius: 0 !important;
    margin: 0 !important;
    padding: 8mm 10mm !important;
    min-height: 0 !important;
    width: 297mm;
    height: 210mm;
    max-height: 210mm;
    overflow: hidden !important;
    page-break-after: always;
    break-after: page;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .slide:last-child {
    page-break-after: auto;
    break-after: auto;
  }
  /* Keep desktop composition (2 columns) — never use narrow/mobile stacking in print. */
  .slide {
    display: flex;
    flex-direction: column;
  }
  .slide-scale {
    width: 100% !important;
    max-width: none !important;
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .split-2 { grid-template-columns: 1fr 1fr !important; gap: 32px !important; }
  .pie-wrap {
    grid-template-columns: auto minmax(160px, max-content) !important;
    gap: 20px !important;
    justify-content: start !important;
    align-items: center !important;
  }
  .bar-row { grid-template-columns: minmax(140px, 32%) 1fr 58px !important; }
  .legend { width: max-content !important; max-width: 320px !important; gap: 10px; }
  .legend li {
    grid-template-columns: 14px max-content auto !important;
    gap: 8px 12px !important;
    font-size: 1rem;
  }
  .title-slide { min-height: 0 !important; height: 210mm; }
  .title-hero { padding: 24px 8px; gap: 14px; }
  .title-hero img.gerb { width: 120px; }
  .title-hero h1 { font-size: 1.7rem; }
  .slide-head { margin-bottom: 18px; padding-bottom: 12px; flex: 0 0 auto; }
  .slide-titles h2 { font-size: 1.28rem; }
  .ctx { font-size: 0.88rem; }
  /* Keep pies at full visual size — do not shrink vs on-screen HTML. */
  .pie { width: 280px !important; height: 280px !important; max-width: none !important; }
  .slide--pies .pie { width: 300px !important; height: 300px !important; }
  .geo-grid img { max-height: 140mm; }
  .slide-body {
    gap: 18px;
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-height: 0;
  }
  .slide--pies .slide-body { justify-content: center; }
  .chart-block h3 { margin-bottom: 12px; font-size: 1.05rem; }
  .bars { gap: 8px; }
  .bar-svg { height: 12px; }
}
/* Mobile stacking only on screen — never when printing to PDF. */
@media screen and (max-width: 800px) {
  .split-2, .pie-wrap, .bar-row { grid-template-columns: 1fr; }
  .pie-wrap { justify-content: stretch; }
  .legend { max-width: none; width: 100%; }
  .legend li { grid-template-columns: 14px 1fr auto; }
  .bar-val { text-align: left; }
}
`.trim();
}

function buildPrintFitScript() {
  // Fit each slide to one landscape A4 page.
  // Short pie slides must NOT be over-shrunk: use page-width layout, enlarge pies,
  // and scale down only when content actually overflows the printable area.
  return `<script>(function(){
  var PAGE_W = 297;
  var PAGE_H = 210;
  var PAD_X = 20;
  var PAD_Y = 16;
  function mmToPx(mm){ return mm * 96 / 25.4; }
  function fitSlides(){
    var slides = document.querySelectorAll('.slide');
    var availW = mmToPx(PAGE_W) - mmToPx(PAD_X);
    var availH = mmToPx(PAGE_H) - mmToPx(PAD_Y);
    slides.forEach(function(slide){
      var inner = slide.querySelector('.slide-scale');
      if (!inner) {
        inner = document.createElement('div');
        inner.className = 'slide-scale';
        while (slide.firstChild) inner.appendChild(slide.firstChild);
        slide.appendChild(inner);
      }
      var pies = inner.querySelectorAll('.pie');
      if (pies.length) slide.classList.add('slide--pies');
      else slide.classList.remove('slide--pies');

      inner.style.transform = 'none';
      inner.style.width = Math.floor(availW) + 'px';
      inner.style.maxWidth = 'none';
      inner.style.height = '';
      pies.forEach(function(p){
        var size = pies.length <= 2 ? 300 : 260;
        p.style.width = size + 'px';
        p.style.height = size + 'px';
      });
      void inner.offsetHeight;

      var rect = inner.getBoundingClientRect();
      var scale = 1;
      if (rect.height > availH + 0.5) scale = availH / rect.height;
      if (rect.width > availW + 0.5) scale = Math.min(scale, availW / rect.width);
      if (!isFinite(scale) || scale <= 0) scale = 1;
      // Never upscale; only shrink overflow. Short pie slides stay full size.
      if (scale > 1) scale = 1;
      inner.style.transformOrigin = 'top left';
      inner.style.transform = scale < 0.999 ? ('scale(' + scale + ')') : 'none';
    });
  }
  function clearFit(){
    document.querySelectorAll('.slide-scale').forEach(function(inner){
      inner.style.transform = '';
      inner.style.width = '';
      inner.style.maxWidth = '';
      inner.style.height = '';
      inner.querySelectorAll('.pie').forEach(function(p){
        p.style.width = '';
        p.style.height = '';
      });
    });
    document.querySelectorAll('.slide--pies').forEach(function(s){ s.classList.remove('slide--pies'); });
  }
  window.addEventListener('beforeprint', fitSlides);
  window.addEventListener('afterprint', clearFit);
  var mo = window.matchMedia && window.matchMedia('print');
  if (mo) {
    if (mo.addEventListener) mo.addEventListener('change', function(e){ e.matches ? fitSlides() : clearFit(); });
    else if (mo.addListener) mo.addListener(function(e){ e.matches ? fitSlides() : clearFit(); });
  }
})();</script>`;
}

/**
 * Build a self-contained HTML presentation (slide deck) from survey analytics.
 * Charts use the same percentages as the on-screen analytics.
 */
export async function buildAnalyticsHtmlString({
  survey,
  items,
  mapImage,
  date = new Date(),
  districtFull = DISTRICT_FULL,
}) {
  const total = items?.length || 0;
  if (!total) throw new Error('Нет данных для презентации');

  const { monthYear, quarterCode, quarterRoman } = quarterParts(date);
  const ctx = `(${districtFull}: ${monthYear}, опрошено ${total})`;
  const slots = mapSurveyToPptxSlots(survey, items);
  const gerbData = await toDataUrl(gerbUrl);
  const mapData = mapImage ? await toDataUrl(mapImage) : '';

  const genderRows = orderGender(rowsFromChart(slots.gender, { sortByShare: false }));
  const ageRows = rowsFromChart(slots.age, { sortByShare: false });
  const professionRows = rowsFromChart(slots.profession);
  const overallRows = rowsFromChart(slots.overall, { sortByShare: false });
  const headRows = rowsFromChart(slots.head, { sortByShare: false });
  const sourceRows = rowsFromChart(slots.sources);
  const sphereBlocks = (slots.spheres || []).map((ch) => ({
    title: ch.questionText || 'Сфера',
    rows: rowsFromChart(ch),
  }));
  const interactionBlocks = (slots.interaction || []).map((ch) => ({
    title: ch.questionText || 'Вопрос',
    rows: rowsFromChart(ch, { sortByShare: false }),
  }));

  const mapBlock = mapData
    ? `<div class="geo-grid"><img src="${mapData}" alt="Карта мест проведения"/></div>`
    : `<p class="muted">Карта недоступна — откройте аналитику с геометками и сформируйте презентацию снова.</p>`;

  const slides = [];

  slides.push(
    `<section class="slide title-slide" data-slide="1">` +
      `<div class="slide-scale">` +
      `<div class="slide-head"><div class="slide-num">1</div>` +
      `<div class="slide-titles"><h2>Титульный слайд</h2><p class="ctx">${escapeHtml(ctx)}</p></div></div>` +
      `<div class="title-hero">` +
      (gerbData ? `<img class="gerb" src="${gerbData}" alt="Герб"/>` : '') +
      `<h1>${escapeHtml(districtFull)}</h1>` +
      `<p class="period">Исследование проблематики, ${escapeHtml(monthYear)}</p>` +
      `<p class="note">Код отчёта: ${escapeHtml(quarterCode)} · ${escapeHtml(quarterRoman)}</p>` +
      `</div></div></section>`
  );

  slides.push(slide(2, 'География исследования — обзор', mapBlock, ctx));

  let n = 3;
  slides.push(
    slide(
      n++,
      'Половозрастной профиль опрошенных',
      `<div class="split-2">` +
        `<div class="chart-block"><h3>Пол</h3><div class="pie-wrap">${svgPie(genderRows)}${legend(genderRows)}</div></div>` +
        `<div class="chart-block"><h3>Возраст</h3><div class="pie-wrap">${svgPie(ageRows)}${legend(ageRows)}</div></div>` +
        `</div>`,
      ctx
    )
  );

  slides.push(
    slide(
      n++,
      'Профессиональный профиль',
      `<div class="chart-block"><h3>${escapeHtml(slots.profession?.questionText || 'Сфера / занятие')}</h3>${barList(professionRows)}</div>`,
      ctx
    )
  );

  slides.push(
    slide(
      n++,
      'Общая оценка положения дел в округе',
      `<div class="chart-block"><h3>${escapeHtml(slots.overall?.questionText || 'Общая ситуация')}</h3>${barList(overallRows)}</div>` +
        `<div class="chart-block"><h3>${escapeHtml(slots.head?.questionText || 'Оценка главы')}</h3>${barList(headRows)}</div>`,
      ctx
    )
  );

  sphereBlocks.forEach((block) => {
    slides.push(
      slide(
        n++,
        `Удовлетворённость сферой`,
        `<div class="chart-block"><h3>${escapeHtml(block.title)}</h3>` +
          `<div class="pie-wrap">${svgPie(block.rows)}${legend(block.rows)}</div></div>`,
        ctx
      )
    );
  });

  slides.push(
    slide(
      n++,
      'Источники информации',
      `<div class="chart-block"><h3>${escapeHtml(slots.sources?.questionText || 'Источники')}</h3>${barList(sourceRows)}</div>`,
      ctx
    )
  );

  slides.push(
    slide(
      n++,
      'Взаимодействие с администрацией',
      interactionBlocks
        .map(
          (b) =>
            `<div class="chart-block"><h3>${escapeHtml(b.title)}</h3>${barList(b.rows)}</div>`
        )
        .join('') || `<p class="muted">Нет данных</p>`,
      ctx
    )
  );

  return (
    `<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"/>` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"/>` +
    `<title>${escapeHtml(`${DISTRICT_CODE} - проблематика в ${quarterCode}`)}</title>` +
    `<style>${buildCss()}</style></head><body>` +
    `<div class="toolbar-print"><button type="button" onclick="window.print()">Печать / PDF</button>` +
    `<span class="note">Цифры совпадают с аналитикой · ${escapeHtml(String(total))} проведений · PDF: альбомная A4, поля «Нет» / минимальные</span></div>` +
    `<main class="deck">${slides.join('\n')}</main>` +
    buildPrintFitScript() +
    `</body></html>`
  );
}

export async function downloadAnalyticsHtml({ survey, items, mapImage, filename }) {
  const html = await buildAnalyticsHtmlString({ survey, items, mapImage });
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || analyticsHtmlFilename();
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
