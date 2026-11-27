import { useEffect, useRef, useState } from 'react';
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

const DEFAULT_CENTER = [55.751244, 37.618423];
const DEFAULT_ZOOM = 12;
const POINT_ZOOM = 16;

function hasValidPoint(geo) {
  return Number.isFinite(Number(geo?.lat)) && Number.isFinite(Number(geo?.lng));
}

function formatCoord(n) {
  return Number(n).toFixed(5);
}

/**
 * Collapsible OSM map for placing/adjusting conduct geo during a survey session.
 */
export default function ConductGeoPicker({
  geo,
  geoStatus,
  onChange,
  onClear,
  onRequestGps,
}) {
  // Open by default so interviewers immediately see where to place the pin.
  const [open, setOpen] = useState(true);
  const mapElRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!open || !mapElRef.current) return undefined;

    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
      markerRef.current = null;
    }

    const start = hasValidPoint(geo)
      ? [Number(geo.lat), Number(geo.lng)]
      : DEFAULT_CENTER;
    const zoom = hasValidPoint(geo) ? POINT_ZOOM : DEFAULT_ZOOM;

    const map = L.map(mapElRef.current, {
      zoomControl: true,
      attributionControl: true,
      scrollWheelZoom: false,
    }).setView(start, zoom);
    map.attributionControl.setPrefix(false);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    const placeMarker = (latlng, { pan = false } = {}) => {
      if (!markerRef.current) {
        markerRef.current = L.marker(latlng, { draggable: true }).addTo(map);
        markerRef.current.on('dragend', () => {
          const pos = markerRef.current.getLatLng();
          onChangeRef.current?.({
            lat: pos.lat,
            lng: pos.lng,
            accuracy: null,
            capturedAt: new Date().toISOString(),
            source: 'manual',
          });
        });
      } else {
        markerRef.current.setLatLng(latlng);
      }
      if (pan) {
        map.setView(latlng, Math.max(map.getZoom(), POINT_ZOOM));
      }
    };

    if (hasValidPoint(geo)) {
      placeMarker([Number(geo.lat), Number(geo.lng)]);
    }

    map.on('click', (e) => {
      placeMarker(e.latlng);
      onChangeRef.current?.({
        lat: e.latlng.lat,
        lng: e.latlng.lng,
        accuracy: null,
        capturedAt: new Date().toISOString(),
        source: 'manual',
      });
    });

    mapRef.current = map;
    const onResize = () => map.invalidateSize();
    const t1 = window.setTimeout(onResize, 50);
    const t2 = window.setTimeout(onResize, 250);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // Recreate only when panel opens; marker sync below handles geo updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || !mapRef.current) return;
    const map = mapRef.current;

    if (!hasValidPoint(geo)) {
      if (markerRef.current) {
        map.removeLayer(markerRef.current);
        markerRef.current = null;
      }
      return;
    }

    const latlng = L.latLng(Number(geo.lat), Number(geo.lng));
    if (!markerRef.current) {
      markerRef.current = L.marker(latlng, { draggable: true }).addTo(map);
      markerRef.current.on('dragend', () => {
        const pos = markerRef.current.getLatLng();
        onChangeRef.current?.({
          lat: pos.lat,
          lng: pos.lng,
          accuracy: null,
          capturedAt: new Date().toISOString(),
          source: 'manual',
        });
      });
    } else {
      const cur = markerRef.current.getLatLng();
      if (Math.abs(cur.lat - latlng.lat) > 1e-7 || Math.abs(cur.lng - latlng.lng) > 1e-7) {
        markerRef.current.setLatLng(latlng);
      }
    }

    if (geo.source === 'gps') {
      map.setView(latlng, Math.max(map.getZoom(), POINT_ZOOM));
    }
  }, [geo, open]);

  const gpsBusy = geoStatus === 'pending';

  return (
    <div className="conduct-geo-picker">
      <div className="conduct-geo-picker__header">
        <strong>Геометка</strong>
        <button
          type="button"
          className="btn btn-ghost conduct-geo-picker__toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? 'Скрыть карту' : 'Показать карту'}
        </button>
      </div>

      {open && (
        <div className="conduct-geo-picker__panel">
          <p className="muted conduct-geo-picker__hint">
            Нажмите на карту или перетащите маркер, чтобы поставить или поправить точку.
          </p>
          <div
            ref={mapElRef}
            className="geo-map geo-map--conduct"
            role="application"
            aria-label="Карта для указания места проведения"
          />
          {hasValidPoint(geo) && (
            <p className="muted conduct-geo-picker__coords">
              {formatCoord(geo.lat)}, {formatCoord(geo.lng)}
            </p>
          )}
          <div className="conduct-geo-picker__actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onRequestGps}
              disabled={gpsBusy}
            >
              {gpsBusy ? 'Определение…' : 'Определить снова'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onClear}
              disabled={!hasValidPoint(geo)}
            >
              Убрать метку
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
