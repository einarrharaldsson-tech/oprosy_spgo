import { useEffect, useMemo, useRef, useState } from 'react';
import AnalyticsGeoMap from './AnalyticsGeoMap';
import PieChart from './PieChart';
import { answerText, formatGeoCoords } from '../lib/responseAnswers';
import { buildQuestionCharts } from '../lib/surveyAnalytics';

function countGeoPoints(items) {
  let n = 0;
  for (const item of items || []) {
    const lat = Number(item?.geo?.lat);
    const lng = Number(item?.geo?.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) n += 1;
  }
  return n;
}

export default function SurveyAnalytics({ survey, items, onError }) {
  const reportRef = useRef(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [xlsxBusy, setXlsxBusy] = useState(false);
  const [deckBusy, setDeckBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const charts = useMemo(
    () => buildQuestionCharts(survey?.questions || [], items),
    [survey, items]
  );
  const geoCount = useMemo(() => countGeoPoints(items), [items]);
  const questions = survey?.questions || [];
  const canExport = items.length > 0;
  const [canHtmlDeck, setCanHtmlDeck] = useState(false);
  const exportBusy = pdfBusy || xlsxBusy || deckBusy;

  const downloadPdf = async () => {
    if (!reportRef.current) return;
    onError?.('');
    setPdfBusy(true);
    try {
      // Give Leaflet time to finish layout before canvas capture.
      await new Promise((resolve) => window.setTimeout(resolve, 450));
      const stamp = new Date().toISOString().slice(0, 10);
      const safeTitle = String(survey?.title || 'opros')
        .replace(/[<>:"/\\|?*]+/g, ' ')
        .trim()
        .slice(0, 80);
      const sessions = items.map((item) => ({
        sessionNumber: item.sessionNumber,
        createdAtLabel: item.createdAt
          ? new Date(item.createdAt).toLocaleString('ru-RU')
          : '',
        geoLabel: formatGeoCoords(item.geo) || '',
        answers: questions.map((q) => ({
          question: q.text,
          answer: answerText(q, item.answers),
        })),
      }));
      const { downloadAnalyticsPdf } = await import('../lib/downloadAnalyticsPdf');
      await downloadAnalyticsPdf(
        reportRef.current,
        `${safeTitle || 'opros'}_analytics_${stamp}.pdf`,
        { sessions }
      );
    } catch (err) {
      onError?.(err.message || 'Не удалось сформировать PDF');
    } finally {
      setPdfBusy(false);
    }
  };

  const downloadXlsx = async () => {
    onError?.('');
    setXlsxBusy(true);
    try {
      // Dynamic chunk is content-hashed; full page reload picks up new builds.
      const { downloadAnalyticsXlsx, analyticsXlsxFilename } = await import(
        '../lib/downloadAnalyticsXlsx'
      );
      const districtCode =
        survey?.municipality?.nameShort || survey?.municipalityNameShort || undefined;
      const districtFull =
        survey?.municipality?.nameFull || survey?.municipalityNameFull || undefined;
      await downloadAnalyticsXlsx({
        survey,
        items,
        district: districtCode,
        districtFull,
        filename: analyticsXlsxFilename(districtCode),
      });
    } catch (err) {
      onError?.(err.message || 'Не удалось сформировать Excel-отчёт');
    } finally {
      setXlsxBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    import('../lib/downloadAnalyticsHtml').then((m) => {
      if (!cancelled) setCanHtmlDeck(canExport && m.isProblematikaPptxSurvey(survey));
    });
    return () => {
      cancelled = true;
    };
  }, [survey, canExport]);

  const downloadHtmlDeck = async () => {
    onError?.('');
    setDeckBusy(true);
    try {
      let mapImage;
      let mapFragments = [];
      const {
        captureOverviewMap,
        captureGeoMapFragments,
        captureVisibleMapNode,
      } = await import('../lib/captureGeoMapFragments');

      // Overview: prefer dedicated capture (waits for tiles). Fall back to the
      // on-screen analytics map if the offscreen path fails.
      try {
        mapImage = await captureOverviewMap(items);
      } catch {
        mapImage = undefined;
      }
      if (!mapImage) {
        try {
          const mapNode = reportRef.current?.querySelector('.leaflet-container');
          mapImage = await captureVisibleMapNode(mapNode);
        } catch {
          mapImage = undefined;
        }
      }

      try {
        mapFragments = await captureGeoMapFragments(items);
      } catch {
        mapFragments = [];
      }

      const { downloadAnalyticsHtml, analyticsHtmlFilename, isProblematikaPptxSurvey } =
        await import('../lib/downloadAnalyticsHtml');
      if (!isProblematikaPptxSurvey(survey)) return;
      const districtCode =
        survey?.municipality?.nameShort || survey?.municipalityNameShort || undefined;
      const districtFull =
        survey?.municipality?.nameFull || survey?.municipalityNameFull || undefined;
      await downloadAnalyticsHtml({
        survey,
        items,
        mapImage,
        mapFragments,
        districtCode,
        districtFull,
        filename: analyticsHtmlFilename(districtCode),
      });
    } catch (err) {
      onError?.(err.message || 'Не удалось сформировать HTML-презентацию');
    } finally {
      setDeckBusy(false);
    }
  };

  if (!items.length) return null;

  return (
    <section className={`analytics ${open ? 'is-open' : ''}`}>
      <div className="row analytics__toolbar">
        <button
          type="button"
          className="analytics__toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="analytics__chevron" aria-hidden>
            {open ? '▼' : '▶'}
          </span>
          <h2 className="analytics__title">Аналитика</h2>
        </button>
        {open && (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-primary"
              style={{ minHeight: 36, padding: '0 12px' }}
              onClick={downloadPdf}
              disabled={exportBusy || !canExport}
            >
              {pdfBusy ? 'Формирование PDF…' : 'Скачать PDF-отчёт'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ minHeight: 36, padding: '0 12px' }}
              data-xlsx-rev="2"
              onClick={downloadXlsx}
              disabled={exportBusy || !canExport}
            >
              {xlsxBusy ? 'Формирование Excel…' : 'Скачать Excel-отчёт'}
            </button>
            {canHtmlDeck && (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ minHeight: 36, padding: '0 12px' }}
                onClick={downloadHtmlDeck}
                disabled={exportBusy}
              >
                {deckBusy ? 'Формирование…' : 'Скачать HTML-презентацию'}
              </button>
            )}
          </div>
        )}
      </div>

      {open && (
        <div ref={reportRef} className="analytics-report">
          <div className="analytics-report__head" data-pdf-block="head">
            <div className="analytics-report__kicker">Отчёт по опросу</div>
            <h3 className="analytics-report__survey">{survey?.title || 'Опрос'}</h3>
            <p className="muted">
              Проведений: {items.length}
              {geoCount > 0 ? ` · с геометкой: ${geoCount}` : ''}
              {' · '}
              {new Date().toLocaleString('ru-RU')}
            </p>
          </div>

          <div className="analytics-grid">
            <AnalyticsGeoMap items={items} />

            {!charts.length ? (
              <p className="muted" style={{ gridColumn: '1 / -1' }}>
                Круговые диаграммы строятся для вопросов с вариантами ответа. Текстовые и адресные
                поля остаются в CSV и в разделе «Все проведения» ниже.
              </p>
            ) : (
              charts.map((chart, index) => (
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
                      <ul className="analytics-other__list">
                        {chart.slices
                          .filter((slice) => slice.otherTexts.length)
                          .flatMap((slice) =>
                            slice.otherTexts.map((text, i) => (
                              <li key={`${slice.id}-${i}`} className="analytics-other__item">
                                {text}
                              </li>
                            ))
                          )}
                      </ul>
                    </div>
                  )}
                </article>
              ))
            )}
          </div>

          <div className="analytics-sessions">
            <h3 className="analytics-sessions__title">Все проведения</h3>
            <div className="stack analytics-sessions__list">
              {items.map((item) => {
                const coords = formatGeoCoords(item.geo);
                return (
                  <article key={item.id} className="panel analytics-session">
                    <div className="analytics-session__meta">
                      <div className="analytics-session__head">
                        <strong>Проведение #{item.sessionNumber}</strong>
                        <span className="muted">
                          {item.createdAt
                            ? new Date(item.createdAt).toLocaleString('ru-RU')
                            : '—'}
                        </span>
                      </div>
                      {coords && (
                        <p className="muted analytics-session__geo">
                          Геометка: {coords}
                        </p>
                      )}
                    </div>
                    <div className="analytics-session__answers">
                      {questions.map((q) => (
                        <div key={q.id} className="analytics-session__qa">
                          <div className="analytics-session__q">{q.text}</div>
                          <div className="muted analytics-session__a">
                            {answerText(q, item.answers)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
