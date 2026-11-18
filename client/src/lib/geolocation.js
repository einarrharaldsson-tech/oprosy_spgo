/**
 * Request current GPS position once. Never throws — returns null on deny/timeout.
 */
export function requestConductGeo(options = {}) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          capturedAt: new Date().toISOString(),
          source: 'gps',
        });
      },
      () => resolve(null),
      {
        enableHighAccuracy: true,
        timeout: options.timeout ?? 15000,
        maximumAge: options.maximumAge ?? 0,
      }
    );
  });
}

export function formatGeoStatus(geo, status) {
  if (status === 'pending') return 'Определение местоположения…';
  if (geo?.lat != null && geo?.lng != null) {
    const acc =
      geo.accuracy != null && Number.isFinite(Number(geo.accuracy))
        ? ` (±${Math.round(Number(geo.accuracy))} м)`
        : '';
    return `Местоположение получено${acc}`;
  }
  if (status === 'denied' || status === 'unavailable') {
    return 'Нет доступа к геолокации — укажите точку на карте или продолжите без неё';
  }
  return '';
}
