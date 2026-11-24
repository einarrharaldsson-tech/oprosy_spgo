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
        `<li><span class="swatch" style="background:${escapeHtml(r.color)}"></span>` +
        `<span class="lab">${escapeHtml(r.label)}</span>` +
        `<span class="val">${pct(r.percent, true)}</span></li>`
    )
    .join('')}</ul>`;
}

function barList(rows) {
  if (!rows.length) return `<p class="muted">Нет данных</p>`;
  return `<div class="bars">${rows
    .map((r) => {
      const w = Math.max(0, Math.min(100, r.percent));
      return (
        `<div class="bar-row">` +
        `<div class="bar-lab">${escapeHtml(r.label)}</div>` +
        `<div class="bar-track"><div class="bar-fill" style="width:${w}%;background:${escapeHtml(r.color)}"></div></div>` +
        `<div class="bar-val">${pct(r.percent, true)}</div>` +
        `</div>`
      );
    })
    .join('')}</div>`;
}

function slide(num, title, body, ctx) {
  return (
    `<section class="slide" data-slide="${num}">` +
    `<header class="slide-head">` +
    `<div class="slide-num">${num}</div>` +
    `<div class="slide-titles"><h2>${escapeHtml(title)}</h2>` +
    (ctx ? `<p class="ctx">${escapeHtml(ctx)}</p>` : '') +
    `</div></header>` +
    `<div class="slide-body">${body}</div>` +
    `</section>`
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
  break-after: page;
  page-break-after: always;
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
.geo-grid img { width: 100%; height: auto; border-radius: 8px; border: 1px solid var(--line); background: #fff; }
.split-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; align-items: start; }
.chart-block h3 { margin: 0 0 12px; font-size: 1.05rem; color: var(--brand); }
.pie-wrap { display: grid; grid-template-columns: auto 1fr; gap: 18px; align-items: center; }
.legend { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.legend li { display: grid; grid-template-columns: 14px 1fr auto; gap: 10px; align-items: center; font-size: 0.95rem; }
.swatch { width: 14px; height: 14px; border-radius: 3px; }
.val { font-weight: 700; color: var(--brand); }
.bars { display: grid; gap: 10px; }
.bar-row { display: grid; grid-template-columns: minmax(120px, 34%) 1fr 56px; gap: 10px; align-items: center; }
.bar-lab { font-size: 0.9rem; line-height: 1.25; }
.bar-track { height: 14px; background: #e7eeee; border-radius: 999px; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 999px; }
.bar-val { text-align: right; font-weight: 700; color: var(--brand); font-size: 0.9rem; }
.muted { color: var(--muted); }
.note { font-size: 0.85rem; color: var(--muted); }
.toolbar-print {
  position: sticky; top: 0; z-index: 5; background: rgba(243,246,246,0.95);
  backdrop-filter: blur(6px); border-bottom: 1px solid var(--line);
  padding: 10px 16px; display: flex; gap: 12px; align-items: center; justify-content: center;
}
.toolbar-print button {
  appearance: none; border: 0; background: var(--brand); color: #fff;
  border-radius: 8px; padding: 10px 16px; font: inherit; font-weight: 600; cursor: pointer;
}
@media print {
  .toolbar-print { display: none !important; }
  body { background: #fff; }
  .deck { max-width: none; padding: 0; }
  .slide { box-shadow: none; border: 0; border-radius: 0; margin: 0; min-height: 100vh; }
}
@media (max-width: 800px) {
  .split-2, .pie-wrap, .bar-row { grid-template-columns: 1fr; }
  .bar-val { text-align: left; }
}
`.trim();
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
      `<div class="slide-head"><div class="slide-num">1</div>` +
      `<div class="slide-titles"><h2>Титульный слайд</h2><p class="ctx">${escapeHtml(ctx)}</p></div></div>` +
      `<div class="title-hero">` +
      (gerbData ? `<img class="gerb" src="${gerbData}" alt="Герб"/>` : '') +
      `<h1>${escapeHtml(districtFull)}</h1>` +
      `<p class="period">Исследование проблематики, ${escapeHtml(monthYear)}</p>` +
      `<p class="note">Код отчёта: ${escapeHtml(quarterCode)} · ${escapeHtml(quarterRoman)}</p>` +
      `</div></section>`
  );

  slides.push(slide(2, 'География исследования — обзор', mapBlock, ctx));
  slides.push(slide(3, 'География исследования — фрагменты', mapBlock, ctx));
  slides.push(slide(4, 'География исследования — детализация', mapBlock, ctx));

  slides.push(
    slide(
      5,
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
      6,
      'Профессиональный профиль',
      `<div class="chart-block"><h3>${escapeHtml(slots.profession?.questionText || 'Сфера / занятие')}</h3>${barList(professionRows)}</div>`,
      ctx
    )
  );

  slides.push(
    slide(
      7,
      'Общая оценка положения дел в округе',
      `<div class="chart-block"><h3>${escapeHtml(slots.overall?.questionText || 'Общая ситуация')}</h3>${barList(overallRows)}</div>` +
        `<div class="chart-block"><h3>${escapeHtml(slots.head?.questionText || 'Оценка главы')}</h3>${barList(headRows)}</div>`,
      ctx
    )
  );

  sphereBlocks.forEach((block, i) => {
    slides.push(
      slide(
        8 + i,
        `Удовлетворённость сферой`,
        `<div class="chart-block"><h3>${escapeHtml(block.title)}</h3>` +
          `<div class="pie-wrap">${svgPie(block.rows)}${legend(block.rows)}</div></div>`,
        ctx
      )
    );
  });

  slides.push(
    slide(
      11,
      'Источники информации',
      `<div class="chart-block"><h3>${escapeHtml(slots.sources?.questionText || 'Источники')}</h3>${barList(sourceRows)}</div>`,
      ctx
    )
  );

  slides.push(
    slide(
      12,
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
    `<span class="note">Цифры совпадают с аналитикой опроса · ${escapeHtml(String(total))} проведений</span></div>` +
    `<main class="deck">${slides.join('\n')}</main>` +
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
