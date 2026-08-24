import { useMemo, useRef, useState } from 'react';
import PieChart from './PieChart';
import { buildQuestionCharts } from '../lib/surveyAnalytics';

export default function SurveyAnalytics({ survey, items, onError }) {
  const reportRef = useRef(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const charts = useMemo(
    () => buildQuestionCharts(survey?.questions || [], items),
    [survey, items]
  );

  const downloadPdf = async () => {
    if (!reportRef.current) return;
    onError?.('');
    setPdfBusy(true);
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      const safeTitle = String(survey?.title || 'opros')
        .replace(/[<>:"/\\|?*]+/g, ' ')
        .trim()
        .slice(0, 80);
      const { downloadAnalyticsPdf } = await import('../lib/downloadAnalyticsPdf');
      await downloadAnalyticsPdf(
        reportRef.current,
        `${safeTitle || 'opros'}_analytics_${stamp}.pdf`
      );
    } catch (err) {
      onError?.(err.message || 'Не удалось сформировать PDF');
    } finally {
      setPdfBusy(false);
    }
  };

  if (!items.length) return null;

  return (
    <section className="analytics">
      <div className="row analytics__toolbar">
        <h2 className="analytics__title">Аналитика</h2>
        <button
          type="button"
          className="btn btn-primary"
          style={{ minHeight: 36, padding: '0 12px' }}
          onClick={downloadPdf}
          disabled={pdfBusy || !charts.length}
        >
          {pdfBusy ? 'Формирование PDF…' : 'Скачать PDF с диаграммами'}
        </button>
      </div>

      {!charts.length ? (
        <p className="muted">
          Круговые диаграммы строятся для вопросов с вариантами ответа. Текстовые и адресные поля
          остаются в CSV.
        </p>
      ) : (
        <div ref={reportRef} className="analytics-report">
          <div className="analytics-report__head" data-pdf-block="head">
            <div className="analytics-report__kicker">Отчёт по опросу</div>
            <h3 className="analytics-report__survey">{survey?.title || 'Опрос'}</h3>
            <p className="muted">
              Проведений: {items.length}
              {' · '}
              {new Date().toLocaleString('ru-RU')}
            </p>
          </div>

          <div className="analytics-grid">
            {charts.map((chart, index) => (
              <article key={chart.questionId} className="panel analytics-card" data-pdf-block="card">
                <h4 className="analytics-card__question">
                  {index + 1}. {chart.questionText}
                </h4>
                {chart.multiple && (
                  <p className="muted analytics-card__note">
                    Можно несколько вариантов — доли считаются от числа проведений, сумма может быть
                    больше 100%.
                  </p>
                )}
                {chart.slices.length ? (
                  <div className="analytics-card__body">
                    <PieChart slices={chart.slices} />
                    <ul className="analytics-legend">
                      {chart.slices.map((slice) => (
                        <li key={slice.id}>
                          <span
                            className="analytics-legend__swatch"
                            style={{ background: slice.color }}
                          />
                          <span>
                            {slice.label}
                            <span className="muted">
                              {' '}
                              — {slice.count} ({slice.percent}%)
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="muted">По этому вопросу пока нет выбранных вариантов.</p>
                )}
                {chart.slices.some((slice) => slice.otherTexts.length) && (
                  <div className="analytics-other">
                    <div className="analytics-other__label">Тексты «Другое»</div>
                    {chart.slices
                      .filter((slice) => slice.otherTexts.length)
                      .map((slice) => (
                        <p key={slice.id} className="muted">
                          {slice.label}: {slice.otherTexts.join('; ')}
                        </p>
                      ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
