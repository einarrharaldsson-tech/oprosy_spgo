import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

// Vite bundles marker assets under hashed URLs — fix default Leaflet icon paths.
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

function formatCoord(n) {
  return Number(n).toFixed(5);
}

function toMarkers(geo, points) {
  const source = points?.length ? points : geo ? [geo] : [];
  return source
    .map((point, index) => ({
      lat: Number(point.lat),
      lng: Number(point.lng),
      accuracy: point.accuracy,
      label: point.label || '',
      key: point.id ?? `${index}`,
    }))
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
}

export default function ResponseGeoMap({ geo, points, title }) {
  const mapElRef = useRef(null);
  const mapRef = useRef(null);
  const markers = useMemo(() => toMarkers(geo, points), [geo, points]);
  const many = markers.length > 1;
  const heading = title || (many ? 'Геометки проведений' : 'Место проведения');

  useEffect(() => {
    if (!markers.length || !mapElRef.current) return undefined;

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

    const layer = L.featureGroup();
    for (const point of markers) {
      const marker = L.marker([point.lat, point.lng]);
      if (point.label) marker.bindTooltip(point.label);
      layer.addLayer(marker);
    }
    layer.addTo(map);

    const bounds = layer.getBounds();
    const northEast = bounds.getNorthEast();
    const southWest = bounds.getSouthWest();
    const spread = markers.length > 1 && (northEast.lat !== southWest.lat || northEast.lng !== southWest.lng);
    if (spread) {
      map.fitBounds(bounds.pad(0.25), { maxZoom: 16 });
    } else {
      map.setView([markers[0].lat, markers[0].lng], 16);
    }

    mapRef.current = map;
    const onResize = () => map.invalidateSize();
    const timer = window.setTimeout(onResize, 50);

    return () => {
      window.clearTimeout(timer);
      map.remove();
      mapRef.current = null;
    };
  }, [markers]);

  if (!markers.length) return null;

  const first = markers[0];
  const osmUrl =
    markers.length === 1
      ? `https://www.openstreetmap.org/?mlat=${first.lat}&mlon=${first.lng}#map=17/${first.lat}/${first.lng}`
      : `https://www.openstreetmap.org/?mlat=${first.lat}&mlon=${first.lng}#map=13/${first.lat}/${first.lng}`;
  const yandexUrl =
    markers.length === 1
      ? `https://yandex.ru/maps/?pt=${first.lng},${first.lat}&z=17&l=map`
      : `https://yandex.ru/maps/?pt=${markers.map((point) => `${point.lng},${point.lat}`).join('~')}&z=13&l=map`;
  const accuracy =
    !many && first.accuracy != null && Number.isFinite(Number(first.accuracy))
      ? Math.round(Number(first.accuracy))
      : null;

  return (
    <div className="geo-block">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
        <strong>{heading}</strong>
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          {many
            ? `${markers.length} точек`
            : `${formatCoord(first.lat)}, ${formatCoord(first.lng)}${accuracy != null ? ` · ±${accuracy} м` : ''}`}
        </span>
      </div>
      <div ref={mapElRef} className="geo-map" role="img" aria-label={heading} />
      <div className="row" style={{ marginTop: 8, gap: 12, flexWrap: 'wrap' }}>
        <a href={osmUrl} target="_blank" rel="noreferrer" className="muted" style={{ fontSize: '0.9rem' }}>
          Открыть в OpenStreetMap
        </a>
        <a href={yandexUrl} target="_blank" rel="noreferrer" className="muted" style={{ fontSize: '0.9rem' }}>
          Открыть в Яндекс.Картах
        </a>
      </div>
    </div>
  );
}
