import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

function formatCoord(n) {
  return Number(n).toFixed(5);
}

function collectPoints(items) {
  const points = [];
  for (const item of items || []) {
    const lat = Number(item?.geo?.lat);
    const lng = Number(item?.geo?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    points.push({
      id: item.id,
      sessionNumber: item.sessionNumber,
      lat,
      lng,
      conductorName: item.conductorName || '',
    });
  }
  return points;
}

function projectPoints(points, width, height, pad = 28) {
  if (!points.length) return [];
  let minLat = points[0].lat;
  let maxLat = points[0].lat;
  let minLng = points[0].lng;
  let maxLng = points[0].lng;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }
  // Keep a usable scale when all points coincide.
  if (maxLat - minLat < 0.0008) {
    minLat -= 0.0004;
    maxLat += 0.0004;
  }
  if (maxLng - minLng < 0.0008) {
    minLng -= 0.0004;
    maxLng += 0.0004;
  }
  const spanLat = maxLat - minLat;
  const spanLng = maxLng - minLng;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  return points.map((p) => ({
    ...p,
    x: pad + ((p.lng - minLng) / spanLng) * innerW,
    // SVG y grows downward; north (higher lat) should be higher on the page.
    y: pad + ((maxLat - p.lat) / spanLat) * innerH,
  }));
}

/**
 * Consolidated map of all response geotags for the analytics report / PDF.
 * Screen: OpenStreetMap (same as the rest of the app).
 * PDF: self-contained SVG schema — no third-party tile services.
 */
export default function AnalyticsGeoMap({ items }) {
  const mapElRef = useRef(null);
  const mapRef = useRef(null);
  const points = useMemo(() => collectPoints(items), [items]);
  const schemaPoints = useMemo(() => projectPoints(points, 640, 280), [points]);
  const total = items?.length || 0;

  useEffect(() => {
    if (!points.length || !mapElRef.current) return undefined;

    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

    const map = L.map(mapElRef.current, {
      zoomControl: true,
      attributionControl: true,
      scrollWheelZoom: false,
    });
    map.attributionControl.setPrefix(false);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    const group = L.featureGroup();
    for (const p of points) {
      const label = [
        `Проведение #${p.sessionNumber}`,
        p.conductorName,
        `${formatCoord(p.lat)}, ${formatCoord(p.lng)}`,
      ]
        .filter(Boolean)
        .join('<br/>');
      L.marker([p.lat, p.lng]).bindPopup(label).addTo(group);
    }
    group.addTo(map);

    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 15);
    } else {
      map.fitBounds(group.getBounds().pad(0.2));
    }

    mapRef.current = map;
    const onResize = () => map.invalidateSize();
    const t1 = window.setTimeout(onResize, 50);
    const t2 = window.setTimeout(onResize, 300);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      map.remove();
      mapRef.current = null;
    };
  }, [points]);

  return (
    <article className="panel analytics-card analytics-geo" data-pdf-block="geo">
      <h4 className="analytics-card__question">Места проведения</h4>
      <p className="muted analytics-card__note">
        С геометкой: {points.length} из {total}
      </p>

      {!points.length ? (
        <p className="muted">Пока нет проведений с геометкой.</p>
      ) : (
        <>
          <div
            ref={mapElRef}
            className="geo-map geo-map--analytics"
            data-pdf-ignore-map="1"
            role="img"
            aria-label="Карта мест проведения опросов"
          />

          {/* Self-contained schematic for PDF export (no tile CDN). Hidden on screen. */}
          <div className="analytics-geo__schema" hidden data-pdf-schema="1">
            <svg
              viewBox="0 0 640 280"
              width="100%"
              height="280"
              role="img"
              aria-label="Схема расположения геометок"
            >
              <rect x="0" y="0" width="640" height="280" fill="#f7f8fa" />
              <rect
                x="12"
                y="12"
                width="616"
                height="256"
                fill="#ffffff"
                stroke="#d7dbe3"
                strokeWidth="1"
              />
              {schemaPoints.map((p) => (
                <g key={p.id}>
                  <circle cx={p.x} cy={p.y} r="8" fill="#2f6fed" />
                  <text
                    x={p.x}
                    y={p.y - 12}
                    textAnchor="middle"
                    fontSize="12"
                    fill="#1f2937"
                    fontFamily="sans-serif"
                  >
                    #{p.sessionNumber}
                  </text>
                </g>
              ))}
            </svg>
            <p className="muted analytics-geo__schema-note">
              Схема взаимного расположения точек (без подложки карты).
            </p>
          </div>

          <ul className="analytics-geo__list">
            {points.map((p) => (
              <li key={p.id}>
                <strong>#{p.sessionNumber}</strong>
                <span className="muted">
                  {' '}
                  · {formatCoord(p.lat)}, {formatCoord(p.lng)}
                  {p.conductorName ? ` · ${p.conductorName}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </article>
  );
}
