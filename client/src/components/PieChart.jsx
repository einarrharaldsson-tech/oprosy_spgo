import { piePath } from '../lib/surveyAnalytics';

export default function PieChart({ slices, size = 220 }) {
  const total = slices.reduce((sum, slice) => sum + slice.count, 0);
  if (!total) {
    return <p className="muted">Нет данных для диаграммы</p>;
  }

  const cx = 100;
  const cy = 100;
  const radius = 92;
  let cursor = 0;
  const arcs = slices.map((slice) => {
    const sweep = (slice.count / total) * 360;
    const start = cursor;
    const end = cursor + sweep;
    cursor = end;
    const fullCircle = slices.length === 1 && sweep >= 359.99;
    return { ...slice, start, end, fullCircle };
  });

  return (
    <svg
      className="pie-chart"
      viewBox="0 0 200 200"
      width={size}
      height={size}
      role="img"
      aria-label="Круговая диаграмма ответов"
    >
      {arcs.map((slice) =>
        slice.fullCircle ? (
          <circle key={slice.id} cx={cx} cy={cy} r={radius} fill={slice.color} />
        ) : (
          <path
            key={slice.id}
            d={piePath(cx, cy, radius, slice.start, slice.end)}
            fill={slice.color}
          />
        )
      )}
    </svg>
  );
}
