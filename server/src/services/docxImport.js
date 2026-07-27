/**
 * Extract paragraphs from a .docx buffer and parse into survey draft structure.
 */

import mammoth from 'mammoth';

const QUESTION_RE = /^(\d+)\.\s+(.+)$/;
const BLANK_LINE_RE = /^_+$/;
const SKIP_HINT_RE = /переход\s+к\s+вопрос|окончание\s+интервью/i;
const JUMP_TO_QUESTION_RE = /переход\s+к\s+вопрос(?:у)?\s*№?\s*(\d+)/i;
const END_INTERVIEW_RE = /окончание\s+интервью/i;
const OPEN_HINT_RE = /открыт(ый|ый\s+вопрос)|открытый\s+вопрос/i;
const MULTI_HINT_RE = /любо(е|ое)\s+число\s+ответов|карточка/i;
const SINGLE_HINT_RE = /один\s+ответ/i;
const ADDRESS_HINT_RE = /населенн(ый|ого)\s+пункт|адрес\s+проживан/i;
const TYPE_HINT_RE = /\(([^)]*(ответ|карточка|открыт)[^)]*)\)/i;

function decodeXmlEntities(s) {
  return String(s || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Remove interviewer-only cue «(Не зачитывать)» from imported text. */
export function stripDoNotRead(text) {
  return String(text || '')
    .replace(/\(\s*не\s*зачитывать\s*\)/gi, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** Strip leftover Word XML fragments that sometimes leak into text. */
export function cleanLine(raw) {
  let s = decodeXmlEntities(raw);
  s = s.replace(/<\/?w:[^>]+>/gi, '');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/\u00a0/g, ' ');
  s = stripDoNotRead(s);
  s = s.replace(/[ \t]+/g, ' ').trim();
  return s;
}

function isBlankUnderline(line) {
  return BLANK_LINE_RE.test(line.replace(/\s/g, ''));
}

function stripOptionNumber(line) {
  return line.replace(/^\d+\.\s+/, '').trim();
}

function extractParenHints(text) {
  const hints = [];
  const re = /\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(text))) {
    hints.push(m[1].trim());
  }
  return hints;
}

/** True if numbered line looks like a real survey question, not an option like «1. Мужской». */
export function looksLikeQuestion(text) {
  const t = cleanLine(text);
  if (!t) return false;
  if (/\?/.test(t)) return true;
  if (TYPE_HINT_RE.test(t)) return true;
  if (/указывается\s+полевым/i.test(t)) return true;
  if (t.length >= 55) return true;
  return false;
}

/**
 * Decide whether a `N. text` line starts a new question given the previous question number.
 * Option lists restart from 1 inside a question — those must not become questions.
 */
export function isQuestionStart(line, lastQNum) {
  const m = line.match(QUESTION_RE);
  if (!m) return false;
  const n = Number(m[1]);
  const text = m[2];
  if (!looksLikeQuestion(text) && n !== 0) {
    // Allow short interviewer fields that continue sequence: «1. Пол. …»
    if (!(lastQNum !== null && n === lastQNum + 1 && /указывается|^\s*пол\b/i.test(text))) {
      return false;
    }
  }
  if (lastQNum === null) {
    return n === 0 || looksLikeQuestion(text);
  }
  if (n === lastQNum + 1) return true;
  if (n > lastQNum && looksLikeQuestion(text)) return true;
  return false;
}

function stripSkipLogic(line) {
  const cut = line.search(SKIP_HINT_RE);
  if (cut < 0) return line;
  if (cut === 0) return '';
  return line.slice(0, cut).trim();
}

function extractJumpMeta(line) {
  const raw = String(line || '');
  if (END_INTERVIEW_RE.test(raw)) {
    return { jumpAction: 'end', jumpToSourceNumber: null };
  }
  const m = raw.match(JUMP_TO_QUESTION_RE);
  if (m) {
    return {
      jumpAction: 'jump',
      jumpToSourceNumber: Number(m[1]),
    };
  }
  return { jumpAction: 'none', jumpToSourceNumber: null };
}

function classifyQuestion(questionText, bodyLines) {
  const lower = questionText.toLowerCase();
  const hints = extractParenHints(questionText).map((h) => h.toLowerCase());
  const hintBlob = hints.join(' | ');

  const hasBlank = bodyLines.some(isBlankUnderline);
  const warnings = [];

  const options = [];
  for (const raw of bodyLines) {
    if (isBlankUnderline(raw)) continue;
    const jumpMeta = extractJumpMeta(raw);
    let line = cleanLine(stripOptionNumber(raw));
    if (!line) continue;
    if (SKIP_HINT_RE.test(line)) {
      warnings.push(`Обнаружен переход в варианте ответа: «${line.slice(0, 80)}»`);
      line = stripSkipLogic(line);
      if (!line) continue;
    }
    options.push({
      text: line,
      jumpAction: jumpMeta.jumpAction,
      jumpToSourceNumber: jumpMeta.jumpToSourceNumber,
    });
  }

  // Dedupe consecutive identical options (Word tab artifacts)
  const deduped = [];
  for (const o of options) {
    const prev = deduped[deduped.length - 1];
    if (
      prev &&
      prev.text === o.text &&
      prev.jumpAction === o.jumpAction &&
      prev.jumpToSourceNumber === o.jumpToSourceNumber
    ) {
      continue;
    }
    deduped.push(o);
  }

  const wantsOpen =
    OPEN_HINT_RE.test(hintBlob) ||
    OPEN_HINT_RE.test(lower) ||
    (hasBlank && deduped.length === 0);

  const wantsMulti = MULTI_HINT_RE.test(hintBlob) || MULTI_HINT_RE.test(lower);
  const wantsAddress = ADDRESS_HINT_RE.test(lower) || ADDRESS_HINT_RE.test(hintBlob);

  if (wantsOpen && deduped.length > 0) {
    warnings.push(
      'Открытый вопрос с вариантами: бланк не перенесён, оставлены только варианты (один выбор)'
    );
    return {
      answerType: 'checkbox',
      allowMultiple: false,
      options: deduped,
      warnings,
    };
  }

  if (wantsOpen || (deduped.length === 0 && hasBlank)) {
    return {
      answerType: wantsAddress ? 'address' : 'text',
      allowMultiple: false,
      options: [],
      warnings,
    };
  }

  if (deduped.length === 0) {
    warnings.push('Не найдены варианты ответа — создан текстовый вопрос');
    return {
      answerType: wantsAddress ? 'address' : 'text',
      allowMultiple: false,
      options: [],
      warnings,
    };
  }

  if (wantsMulti) {
    return {
      answerType: 'checkbox',
      allowMultiple: true,
      options: deduped,
      warnings,
    };
  }

  return {
    answerType: 'checkbox',
    allowMultiple: false,
    options: deduped,
    warnings,
  };
}

function questionDisplayText(raw) {
  return cleanLine(raw).replace(/\s*_+\s*$/g, '').trim();
}

/**
 * @param {string[]} paragraphs
 * @returns {{ title: string, description: string, questions: object[], warnings: string[] }}
 */
export function parseSurveyParagraphs(paragraphs) {
  const lines = paragraphs.map(cleanLine).filter((l) => l.length > 0);
  const warnings = [];
  const questionStarts = [];
  let lastQNum = null;

  for (let i = 0; i < lines.length; i++) {
    if (isQuestionStart(lines[i], lastQNum)) {
      const n = Number(lines[i].match(QUESTION_RE)[1]);
      questionStarts.push(i);
      lastQNum = n;
    }
  }

  if (!questionStarts.length) {
    return {
      title: lines[0] || 'Импортированный опрос',
      description: '',
      questions: [],
      warnings: ['В документе не найдены пронумерованные вопросы вида «1. …»'],
    };
  }

  const preamble = lines.slice(0, questionStarts[0]);
  let title = (preamble[0] || 'Импортированный опрос').slice(0, 255);

  let description = '';
  const intro = preamble.find((l) => /^добрый\b/i.test(l));
  if (intro) {
    description = intro;
  } else if (preamble.length > 1) {
    description = preamble.slice(1).join('\n');
  }

  const questions = [];

  for (let qi = 0; qi < questionStarts.length; qi++) {
    const start = questionStarts[qi];
    const end = qi + 1 < questionStarts.length ? questionStarts[qi + 1] : lines.length;
    const head = lines[start];
    const m = head.match(QUESTION_RE);
    const num = m[1];
    const rawText = m[2];
    const body = lines.slice(start + 1, end);

    const bodyFiltered = [];
    for (const bl of body) {
      if (/^и\s+завершающ/i.test(bl) || /^спасибо\s+за\s+участие/i.test(bl)) {
        warnings.push(`Служебная строка пропущена: «${bl.slice(0, 80)}»`);
        continue;
      }
      bodyFiltered.push(bl);
    }

    const classified = classifyQuestion(rawText, bodyFiltered);
    for (const w of classified.warnings) {
      warnings.push(`Вопрос ${num}: ${w}`);
    }

    const hasSkipLogic = bodyFiltered.some((l) => SKIP_HINT_RE.test(l));
    if (hasSkipLogic) {
      warnings.push(
        `Вопрос ${num}: снята обязательность (в анкете есть «Переход к вопросу» / окончание интервью)`
      );
    }

    questions.push({
      sourceNumber: Number(num),
      text: questionDisplayText(rawText),
      answerType: classified.answerType,
      isRequired: !hasSkipLogic,
      allowMultiple: classified.allowMultiple,
      options: classified.options,
    });
  }

  if (questions.length) {
    warnings.unshift(`Распознано вопросов: ${questions.length}`);
  }

  return { title, description, questions, warnings };
}

/**
 * @param {Buffer} buffer
 */
export async function extractParagraphsFromDocx(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value || '';
  const paragraphs = text
    .split(/\r?\n/)
    .map((l) => cleanLine(l))
    .filter((l) => l.length > 0);
  return {
    paragraphs,
    messages: (result.messages || []).map((m) => m.message),
  };
}

/**
 * Full pipeline: docx buffer → draft preview payload
 * @param {Buffer} buffer
 */
export async function parseDocxSurvey(buffer) {
  const { paragraphs, messages } = await extractParagraphsFromDocx(buffer);
  const parsed = parseSurveyParagraphs(paragraphs);
  const warnings = [...parsed.warnings];
  if (messages.length) {
    warnings.push(...messages.map((m) => `Word: ${m}`));
  }
  if (!paragraphs.length) {
    warnings.push('Документ пуст или не удалось извлечь текст');
  }
  return {
    title: parsed.title,
    description: parsed.description,
    questions: parsed.questions,
    warnings,
  };
}
