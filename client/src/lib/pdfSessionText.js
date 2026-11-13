const BRAND = [15, 61, 62];
const QUESTION = [17, 24, 39];
const ANSWER = [71, 85, 105];
const MUTED = [100, 116, 139];

function lineMm(fontPt) {
  return fontPt * 0.3528 * 1.35;
}

function wrapped(pdf, text, width, fontPt, style) {
  pdf.setFont('Manrope', style);
  pdf.setFontSize(fontPt);
  const value = String(text || '').trim() || '—';
  const lines = pdf.splitTextToSize(value, width);
  return { lines, height: lines.length * lineMm(fontPt) };
}

function sessionPieces(pdf, session, width) {
  const title = wrapped(pdf, session.title, width * 0.62, 11, 'bold');
  const date = session.date ? wrapped(pdf, session.date, width * 0.36, 9, 'normal') : null;
  const geo = session.geo ? wrapped(pdf, session.geo, width, 9.5, 'normal') : null;
  const answers = (session.answers || []).map((answer) => ({
    question: wrapped(pdf, answer.question, width, 10, 'bold'),
    answer: wrapped(pdf, answer.answer, width, 10, 'normal'),
  }));
  let height = Math.max(title.height, date?.height || 0);
  if (geo) height += geo.height;
  for (const block of answers) {
    height += block.question.height + block.answer.height + 1.2;
  }
  height += 3.5;
  return { title, date, geo, answers, height };
}

function paint(pdf, lines, x, top, fontPt, style, color, align, layout) {
  const step = lineMm(fontPt);
  const { margin, pageHeight } = layout;
  pdf.setFont('Manrope', style);
  pdf.setFontSize(fontPt);
  pdf.setTextColor(...color);
  let y = top;
  for (const line of lines) {
    if (y + step > pageHeight - margin) {
      pdf.addPage();
      y = margin;
    }
    const baseline = y + step * 0.78;
    if (align === 'right') pdf.text(line, x, baseline, { align: 'right' });
    else pdf.text(line, x, baseline);
    y += step;
  }
  return y;
}

/**
 * Write "Все проведения" as real PDF text. A session moves to the next page
 * when it fits on a blank page but not in the space left. Longer sessions
 * break between lines.
 */
export function writeSessions(pdf, model, cursorY, layout) {
  const sessions = model?.sessions || [];
  if (!sessions.length) return cursorY;
  const { margin, pageHeight, usableWidth } = layout;
  const contentBottom = pageHeight - margin;
  const pageContent = contentBottom - margin;

  const heading = wrapped(pdf, model.heading || 'Все проведения', usableWidth, 13, 'bold');
  const measured = sessions.map((session) => sessionPieces(pdf, session, usableWidth));
  const firstBlock = heading.height + 1.5 + Math.min(measured[0].height, 36);
  if (cursorY > margin && cursorY + firstBlock > contentBottom) {
    pdf.addPage();
    cursorY = margin;
  }

  cursorY = paint(pdf, heading.lines, margin, cursorY, 13, 'bold', BRAND, undefined, layout);
  cursorY += 1.5;

  measured.forEach((piece) => {
    if (piece.height <= pageContent && cursorY > margin && cursorY + piece.height > contentBottom) {
      pdf.addPage();
      cursorY = margin;
    }

    const titleTop = cursorY;
    const titleBottom = paint(pdf, piece.title.lines, margin, titleTop, 11, 'bold', BRAND, undefined, layout);
    if (piece.date) {
      paint(
        pdf,
        piece.date.lines,
        margin + usableWidth,
        titleTop,
        9,
        'normal',
        MUTED,
        'right',
        layout
      );
    }
    cursorY = Math.max(titleBottom, titleTop + (piece.date?.height || 0));

    if (piece.geo) {
      cursorY = paint(pdf, piece.geo.lines, margin, cursorY, 9.5, 'normal', MUTED, undefined, layout);
    }

    for (const block of piece.answers) {
      const questionFit = block.question.height + lineMm(10);
      if (cursorY + questionFit > contentBottom && cursorY > margin && questionFit <= pageContent) {
        pdf.addPage();
        cursorY = margin;
      }
      cursorY = paint(pdf, block.question.lines, margin, cursorY, 10, 'bold', QUESTION, undefined, layout);
      cursorY = paint(pdf, block.answer.lines, margin, cursorY, 10, 'normal', ANSWER, undefined, layout);
      cursorY += 1.2;
    }
    cursorY += 2.3;
  });

  return cursorY;
}

export function readSessionsFromReport(element) {
  const heading =
    element.querySelector('[data-pdf-block="sessions-head"]')?.textContent?.trim() ||
    'Все проведения';
  const sessions = [...element.querySelectorAll('[data-pdf-block="session"]')].map((node) => {
    const title = node.querySelector('.analytics-session__head strong')?.textContent?.trim() || '';
    const date = node.querySelector('.analytics-session__head .muted')?.textContent?.trim() || '';
    const geo = node.querySelector('.analytics-session__geo')?.textContent?.trim() || '';
    const answers = [...node.querySelectorAll('.analytics-session__qa')].map((qa) => ({
      question: qa.querySelector('.analytics-session__q')?.textContent?.trim() || '',
      answer: qa.querySelector('.analytics-session__a')?.textContent?.trim() || '—',
    }));
    return { title, date, geo, answers };
  });
  return { heading, sessions };
}
