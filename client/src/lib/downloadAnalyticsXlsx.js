import ExcelJS from 'exceljs';
import { isOtherOptionText } from './options';
import { isChoiceQuestion } from './surveyAnalytics';

export const DISTRICT_CODE = 'СПГО';
export const DISTRICT_FULL = 'Сергиево - Посадский городской округ';

const thin = { style: 'thin', color: { argb: 'FF000000' } };
const thinBorder = { top: thin, left: thin, bottom: thin, right: thin };

function font(opts = {}) {
  return { name: 'Calibri', size: 11, ...opts };
}

function applyBorder(cell) {
  cell.border = thinBorder;
}

function styleTitle(cell) {
  cell.font = font({ bold: true, size: 11 });
  cell.alignment = { horizontal: 'center', vertical: 'center', wrapText: true };
  applyBorder(cell);
}

function styleHeader(cell) {
  cell.font = font({ size: 11 });
  cell.alignment = { horizontal: 'center', vertical: 'center', wrapText: true };
  applyBorder(cell);
}

function styleOption(cell) {
  cell.font = font({ size: 10 });
  cell.alignment = { horizontal: 'left', vertical: 'center', wrapText: true };
  applyBorder(cell);
}

function styleTotal(cell) {
  cell.font = font({ bold: true, size: 11 });
  cell.alignment = { horizontal: 'left', vertical: 'center', wrapText: true };
  applyBorder(cell);
}

function styleCount(cell, bold = false) {
  cell.font = font({ bold, size: 11 });
  cell.alignment = { horizontal: 'center', vertical: 'center', wrapText: true };
  applyBorder(cell);
  cell.numFmt = '0';
}

function stylePercent(cell, bold = false) {
  cell.font = font({ bold, size: 11 });
  cell.alignment = { horizontal: 'center', vertical: 'center', wrapText: true };
  applyBorder(cell);
  // Same rounding as analytics charts: one decimal place + % sign.
  cell.numFmt = '0.0"%"';
}

/** Same rounding as SurveyAnalytics charts (share of sessions). */
function roundPercent(count, total) {
  if (!total) return 0;
  return Math.round((count / total) * 1000) / 10;
}

/** e.g. 4кв26 for November 2026 */
export function quarterLabel(date = new Date()) {
  const q = Math.floor(date.getMonth() / 3) + 1;
  const yy = String(date.getFullYear()).slice(-2);
  return `${q}кв${yy}`;
}

function safeFilenamePart(value, fallback = 'опрос') {
  const cleaned = String(value || '')
    .replace(/[<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || fallback).slice(0, 80);
}

/** Universal analytics workbook name: «Округ - Название опроса.xlsx». */
export function analyticsXlsxFilename(district = DISTRICT_CODE, surveyTitle) {
  const code = safeFilenamePart(district || DISTRICT_CODE, DISTRICT_CODE);
  return `${code} - ${safeFilenamePart(surveyTitle)}.xlsx`;
}

/**
 * Frequency rows for one choice question: every survey option (incl. zeros),
 * plus any unexpected options that appeared in answers.
 */
function buildFrequencyRows(question, items) {
  const buckets = new Map();
  for (const option of question.options || []) {
    const label = String(option.text || 'Вариант').trim() || 'Вариант';
    buckets.set(option.id, {
      id: option.id,
      label,
      count: 0,
      otherTexts: [],
      isOther: isOtherOptionText(label),
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
        const label = String(answer.optionText || 'Вариант').trim() || 'Вариант';
        bucket = {
          id: answer.optionId,
          label,
          count: 0,
          otherTexts: [],
          isOther: isOtherOptionText(label),
        };
        buckets.set(answer.optionId, bucket);
      }
      bucket.count += 1;
      const extra = String(answer.textValue || '').trim();
      if (extra) bucket.otherTexts.push(extra);
    }
  }

  const rows = [...buckets.values()];
  if (unanswered > 0) {
    rows.push({
      id: 'unanswered',
      label: 'Без ответа',
      count: unanswered,
      otherTexts: [],
      isOther: false,
    });
  }
  return rows;
}

/** Value row under a title: headcount | municipality full name (no header labels). */
function writeHeadcountMunicipalityRows(ws, startRow, total, districtFull) {
  const label = districtFull || DISTRICT_FULL;
  let r = startRow;

  styleCount(ws.getCell(r, 1), true);
  ws.getCell(r, 1).value = total;
  styleHeader(ws.getCell(r, 2));
  ws.getCell(r, 2).value = label;
  r += 1;

  return r;
}

function writeMunicipalityBlock(ws, startRow, total, districtFull) {
  const label = districtFull || DISTRICT_FULL;
  let r = startRow;
  ws.mergeCells(r, 1, r, 2);
  styleTitle(ws.getCell(r, 1));
  ws.getCell(r, 1).value = label;
  applyBorder(ws.getCell(r, 2));
  r += 1;

  r = writeHeadcountMunicipalityRows(ws, r, total, label);

  styleTotal(ws.getCell(r, 1));
  ws.getCell(r, 1).value = 'Всего';
  styleCount(ws.getCell(r, 2), true);
  ws.getCell(r, 2).value = total;
  r += 1;

  return r + 2; // blank gap like the template
}

function writeQuestionBlock(ws, startRow, questionText, districtFull, rows, totalRespondents) {
  const label = districtFull || DISTRICT_FULL;
  let r = startRow;
  ws.mergeCells(r, 1, r, 2);
  styleTitle(ws.getCell(r, 1));
  ws.getCell(r, 1).value = questionText;
  applyBorder(ws.getCell(r, 2));
  r += 1;

  r = writeHeadcountMunicipalityRows(ws, r, totalRespondents, label);

  // Answer rows: % of sessions (same as analytics charts).
  const firstData = r;
  for (const row of rows) {
    styleOption(ws.getCell(r, 1));
    ws.getCell(r, 1).value = row.label;
    stylePercent(ws.getCell(r, 2));
    ws.getCell(r, 2).value = roundPercent(row.count, totalRespondents);
    r += 1;
  }
  const lastData = r - 1;

  styleTotal(ws.getCell(r, 1));
  ws.getCell(r, 1).value = 'Всего';
  stylePercent(ws.getCell(r, 2), true);
  if (lastData >= firstData) {
    ws.getCell(r, 2).value = { formula: `SUM(B${firstData}:B${lastData})` };
  } else {
    ws.getCell(r, 2).value = 0;
  }
  r += 1;

  const otherRows = rows.filter((row) => row.isOther || (row.otherTexts || []).length);
  const otherCount = otherRows.reduce((sum, row) => sum + (row.count || 0), 0);
  const otherTexts = otherRows.flatMap((row) => row.otherTexts || []);
  if (otherCount > 0 || otherTexts.length) {
    r += 2;
    ws.mergeCells(r, 1, r, 2);
    styleTitle(ws.getCell(r, 1));
    ws.getCell(r, 1).value = `${questionText} - другое`;
    applyBorder(ws.getCell(r, 2));
    r += 1;

    // Same % as analytics charts (share of sessions). Plain text so Excel shows it clearly.
    styleHeader(ws.getCell(r, 1));
    ws.getCell(r, 1).value = '% ответа другое';
    stylePercent(ws.getCell(r, 2), true);
    const otherPercent = roundPercent(otherCount, totalRespondents);
    ws.getCell(r, 2).value = `${String(otherPercent).replace('.', ',')}%`;
    r += 1;

    // Identical free-text answers → one row with % of all respondents.
    for (const group of aggregateOtherTexts(otherTexts)) {
      styleOption(ws.getCell(r, 1));
      ws.getCell(r, 1).value = group.label;
      stylePercent(ws.getCell(r, 2));
      ws.getCell(r, 2).value = roundPercent(group.count, totalRespondents);
      r += 1;
    }
  }

  return r + 2;
}

/** Group identical «другое» texts (case/spacing-insensitive); keep first label. */
function aggregateOtherTexts(texts) {
  const groups = new Map();
  for (const raw of texts || []) {
    const label = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!label) continue;
    const key = label.toLowerCase();
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      groups.set(key, { label, count: 1 });
    }
  }
  return [...groups.values()].sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ru')
  );
}

/**
 * Build and download the municipal analytics XLSX for any survey.
 * Layout matches the official problematika template: municipality headcount,
 * then one frequency block per choice question (options from the survey itself),
 * plus «другое» free-text when present. Works for future surveys with any
 * questions / answer options. CSV remains the raw session export.
 */
export async function downloadAnalyticsXlsx({
  survey,
  items,
  district,
  districtFull,
  filename,
}) {
  const total = items?.length || 0;
  if (!total) throw new Error('Нет данных для Excel-отчёта');

  const questions = (survey?.questions || []).filter(isChoiceQuestion);
  if (!questions.length) {
    throw new Error('В опросе нет вопросов с вариантами ответов для Excel-отчёта');
  }

  const resolvedCode =
    district ||
    survey?.municipality?.nameShort ||
    survey?.municipalityNameShort ||
    DISTRICT_CODE;
  const resolvedFull =
    districtFull ||
    survey?.municipality?.nameFull ||
    survey?.municipalityNameFull ||
    DISTRICT_FULL;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Реплика';
  workbook.created = new Date();
  const ws = workbook.addWorksheet('Лист1', {
    properties: { defaultRowHeight: 18 },
    views: [{ state: 'normal', showGridLines: true }],
  });

  ws.getColumn(1).width = 65;
  ws.getColumn(2).width = 36;
  ws.getColumn(3).width = 13;
  ws.getColumn(4).width = 32;

  let row = 1;
  row = writeMunicipalityBlock(ws, row, total, resolvedFull);

  for (const question of questions) {
    const rows = buildFrequencyRows(question, items);
    row = writeQuestionBlock(
      ws,
      row,
      String(question.text || '').trim() || 'Вопрос',
      resolvedFull,
      rows,
      total
    );
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download =
    filename || analyticsXlsxFilename(resolvedCode, survey?.title);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
