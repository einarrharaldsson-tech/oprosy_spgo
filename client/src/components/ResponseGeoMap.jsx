import { useEffect, useRef } from 'react';
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

export default function ResponseGeoMap({ geo }) {
  const mapElRef = useRef(null);
  const mapRef = useRef(null);

  const lat = geo?.lat;
  const lng = geo?.lng;
  const hasPoint = Number.isFinite(lat) && Number.isFinite(lng);

  useEffect(() => {
    if (!hasPoint || !mapElRef.current) return undefined;

    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

    const map = L.map(mapElRef.current, {
      zoomControl: true,
      attributionControl: true,
      scrollWheelZoom: false,
    }).setView([lat, lng], 16);
    map.attributionControl.setPrefix(false);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    L.marker([lat, lng]).addTo(map);
    mapRef.current = map;

    const onResize = () => map.invalidateSize();
    window.setTimeout(onResize, 50);

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [hasPoint, lat, lng]);

  if (!hasPoint) return null;

  const osmUrl = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
  const yandexUrl = `https://yandex.ru/maps/?pt=${lng},${lat}&z=17&l=map`;
  const accuracy =
    geo.accuracy != null && Number.isFinite(Number(geo.accuracy))
      ? Math.round(Number(geo.accuracy))
      : null;

  return (
    <div className="geo-block">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
        <strong>Место проведения</strong>
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          {formatCoord(lat)}, {formatCoord(lng)}
          {accuracy != null ? ` · ±${accuracy} м` : ''}
        </span>
      </div>
      <div ref={mapElRef} className="geo-map" role="img" aria-label="Карта места проведения" />
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
