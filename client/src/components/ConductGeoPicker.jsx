import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import AddressInput from './AddressInput';
import { resolveAddressToCoordinates, resolveCoordinatesToAddress } from '../lib/addressGeocode';
import { formatGeoStatus, requestConductGeo } from '../lib/geolocation';

const DEFAULT_CENTER = { lat: 56.311, lng: 38.135 };

export default function ConductGeoPicker({
  geo,
  onGeoChange,
  addressLabel,
  onAddressLabelChange,
  disabled,
}) {
  const mapElRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const onGeoChangeRef = useRef(onGeoChange);
  const onAddressRef = useRef(onAddressLabelChange);
  const reverseSeqRef = useRef(0);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [addrLoading, setAddrLoading] = useState(false);

  useEffect(() => {
    onGeoChangeRef.current = onGeoChange;
  }, [onGeoChange]);

  useEffect(() => {
    onAddressRef.current = onAddressLabelChange;
  }, [onAddressLabelChange]);

  const hasPoint = geo?.lat != null && geo?.lng != null;
  const lat = geo?.lat ?? DEFAULT_CENTER.lat;
  const lng = geo?.lng ?? DEFAULT_CENTER.lng;

  const reverseGeocode = useCallback(async (nextLat, nextLng) => {
    const seq = ++reverseSeqRef.current;
    setAddrLoading(true);
    try {
      const label = await resolveCoordinatesToAddress(nextLat, nextLng);
      if (seq !== reverseSeqRef.current) return;
      if (label) onAddressRef.current(label);
    } finally {
      if (seq === reverseSeqRef.current) setAddrLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!mapElRef.current) return undefined;

    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
      markerRef.current = null;
    }

    const map = L.map(mapElRef.current, {
      zoomControl: true,
      attributionControl: false,
      scrollWheelZoom: !disabled,
      tap: false,
    }).setView([lat, lng], hasPoint ? 16 : 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(map);

    if (hasPoint) {
      markerRef.current = L.circleMarker([lat, lng], {
        radius: 10,
        color: '#0f3d3e',
        fillColor: '#1a5c5e',
        fillOpacity: 0.9,
        weight: 2,
      }).addTo(map);
    }

    if (!disabled) {
      map.on('click', (e) => {
        const { lat: pLat, lng: pLng } = e.latlng;
        if (!markerRef.current) {
          markerRef.current = L.circleMarker([pLat, pLng], {
            radius: 10,
            color: '#0f3d3e',
            fillColor: '#1a5c5e',
            fillOpacity: 0.9,
            weight: 2,
          }).addTo(map);
        } else {
          markerRef.current.setLatLng(e.latlng);
        }
        onGeoChangeRef.current({
          lat: pLat,
          lng: pLng,
          accuracy: null,
          capturedAt: new Date().toISOString(),
          source: 'manual',
        });
        void reverseGeocode(pLat, pLng);
      });
    }

    mapRef.current = map;

    const onResize = () => map.invalidateSize();
    window.setTimeout(onResize, 50);

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, [disabled, hasPoint, lat, lng, reverseGeocode]);

  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || geo?.lat == null || geo?.lng == null) return;
    if (!marker) {
      markerRef.current = L.circleMarker([geo.lat, geo.lng], {
        radius: 10,
        color: '#0f3d3e',
        fillColor: '#1a5c5e',
        fillOpacity: 0.9,
        weight: 2,
      }).addTo(map);
    } else {
      marker.setLatLng([geo.lat, geo.lng]);
    }
    map.panTo([geo.lat, geo.lng]);
  }, [geo?.lat, geo?.lng]);

  const onAddressPick = async (item) => {
    setAddrLoading(true);
    try {
      const label = item.value || item.unrestrictedValue || '';
      const coords = await resolveAddressToCoordinates(item);
      if (coords) {
        onGeoChange({
          lat: coords.lat,
          lng: coords.lng,
          accuracy: null,
          capturedAt: new Date().toISOString(),
          source: 'manual',
        });
      }
      if (label) onAddressLabelChange(label);
    } finally {
      setAddrLoading(false);
    }
  };

  const onGps = async () => {
    if (disabled || gpsBusy) return;
    setGpsBusy(true);
    try {
      const pos = await requestConductGeo();
      if (pos) {
        onGeoChange({ ...pos, source: 'gps' });
        void reverseGeocode(pos.lat, pos.lng);
      }
    } finally {
      setGpsBusy(false);
    }
  };

  return (
    <div className="geo-block conduct-geo-picker">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
        <strong>Место проведения</strong>
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          {hasPoint ? formatGeoStatus(geo, 'ok') : 'Точка не выбрана'}
        </span>
      </div>
      <p className="muted" style={{ margin: '0 0 8px', fontSize: '0.9rem' }}>
        Нажмите на карту или выберите адрес из подсказок — точка и адрес синхронизируются.
      </p>
      <div ref={mapElRef} className="geo-map" role="application" aria-label="Выбор точки на карте" />
      <div className="row" style={{ marginTop: 10, gap: 8 }}>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={disabled || gpsBusy}
          onClick={onGps}
        >
          {gpsBusy ? 'Определение…' : 'Моё местоположение'}
        </button>
      </div>
      <div className="field" style={{ marginTop: 12 }}>
        <label>Адрес места</label>
        {addrLoading ? <span className="muted address-suggest-status">Определение адреса…</span> : null}
        <AddressInput
          value={addressLabel || ''}
          onChange={onAddressLabelChange}
          onPick={onAddressPick}
          disabled={disabled}
          placeholder="Город, улица, дом…"
        />
      </div>
    </div>
  );
}
