import { useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import PieChart from './PieChart';
import ResponseGeoMap from './ResponseGeoMap';
import { buildQuestionCharts } from '../lib/surveyAnalytics';

export default function SurveyAnalytics({ survey, items, onError, open = true, onOpenChange }) {
  const reportRef = useRef(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const charts = useMemo(
    () => buildQuestionCharts(survey?.questions || [], items),
    [survey, items]
  );
  const geoPoints = useMemo(
    () =>
      (items || [])
        .filter(
          (item) =>
            item?.geo &&
            Number.isFinite(Number(item.geo.lat)) &&
            Number.isFinite(Number(item.geo.lng))
        )
        .map((item) => ({
          id: item.id,
          lat: Number(item.geo.lat),
          lng: Number(item.geo.lng),
          accuracy: item.geo.accuracy,
          label: `Проведение #${item.sessionNumber ?? item.id}`,
        })),
    [items]
  );
  const hasReport = charts.length > 0 || geoPoints.length > 0;

  const downloadPdf = async () => {
    onError?.('');
    if (!open) {
      flushSync(() => onOpenChange?.(true));
    }
    if (!reportRef.current) return;
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
        <h2 className="analytics__title">
          <button
            type="button"
            className="analytics-toggle"
            aria-expanded={open}
            aria-controls="survey-analytics-panel"
            onClick={() => onOpenChange?.(!open)}
          >
            <span className="response-card-chevron" aria-hidden>
              {open ? '▼' : '▶'}
            </span>
            Аналитика
          </button>
        </h2>
        <button
          type="button"
          className="btn btn-primary"
          style={{ minHeight: 36, padding: '0 12px' }}
          onClick={downloadPdf}
          disabled={pdfBusy || !hasReport}
        >
          {pdfBusy ? 'Формирование PDF…' : 'Скачать PDF с диаграммами'}
        </button>
      </div>

      {open && !hasReport && (
        <p id="survey-analytics-panel" className="muted">
          Круговые диаграммы строятся для вопросов с вариантами ответа. Текстовые и адресные поля
          остаются в CSV.
        </p>
      )}

      {open && hasReport && (
        <div id="survey-analytics-panel" ref={reportRef} className="analytics-report">
          <div className="analytics-report__head" data-pdf-block="head">
            <div className="analytics-report__kicker">Отчёт по опросу</div>
            <h3 className="analytics-report__survey">{survey?.title || 'Опрос'}</h3>
            <p className="muted">
              Проведений: {items.length}
              {' · '}
              {new Date().toLocaleString('ru-RU')}
            </p>
          </div>

          {geoPoints.length > 0 && (
            <div className="analytics-geo" data-pdf-block="card">
              <ResponseGeoMap points={geoPoints} title="Геометки проведений" />
            </div>
          )}

          {!charts.length && (
            <p className="muted">
              Круговые диаграммы строятся для вопросов с вариантами ответа. Текстовые и адресные поля
              остаются в CSV.
            </p>
          )}

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
