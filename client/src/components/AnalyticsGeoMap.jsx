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
      createdAt: item.createdAt || null,
    });
  }
  return points;
}

/**
 * Consolidated map of all response geotags for the analytics report / PDF.
 */
export default function AnalyticsGeoMap({ items }) {
  const mapElRef = useRef(null);
  const mapRef = useRef(null);
  const points = useMemo(() => collectPoints(items), [items]);
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

    // Carto tiles usually allow CORS — needed for html2canvas PDF export.
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      subdomains: 'abcd',
      crossOrigin: true,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
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
            role="img"
            aria-label="Карта мест проведения опросов"
          />
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
