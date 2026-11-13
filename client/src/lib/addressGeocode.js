import { api } from '../api';

const NOMINATIM_UA = 'OprosySPGO/1.3.3 (field surveys)';

async function nominatimSearch(query) {
  const q = String(query || '').trim();
  if (q.length < 3) return null;
  const url =
    `https://nominatim.openstreetmap.org/search?` +
    new URLSearchParams({ q, format: 'json', limit: '1', 'accept-language': 'ru' });
  const res = await fetch(url, { headers: { 'User-Agent': NOMINATIM_UA } });
  if (!res.ok) return null;
  const list = await res.json();
  const hit = list?.[0];
  if (!hit?.lat || !hit?.lon) return null;
  return {
    lat: Number(hit.lat),
    lng: Number(hit.lon),
    label: hit.display_name || q,
  };
}

async function nominatimReverse(lat, lng) {
  const url =
    `https://nominatim.openstreetmap.org/reverse?` +
    new URLSearchParams({
      lat: String(lat),
      lon: String(lng),
      format: 'json',
      'accept-language': 'ru',
    });
  const res = await fetch(url, { headers: { 'User-Agent': NOMINATIM_UA } });
  if (!res.ok) return null;
  const data = await res.json();
  return data.display_name?.trim() || null;
}

export async function resolveAddressToCoordinates(item) {
  const label = (item.value || item.unrestrictedValue || '').trim();
  if (item.lat != null && item.lng != null && Number.isFinite(item.lat) && Number.isFinite(item.lng)) {
    return { lat: item.lat, lng: item.lng };
  }
  if (label.length >= 2) {
    try {
      const data = await api('/dadata/address', { method: 'POST', body: { query: label, count: 5 } });
      const list = data.suggestions || [];
      const hit =
        list.find((s) => s.value === item.value && s.lat != null && s.lng != null) ||
        list.find((s) => s.lat != null && s.lng != null);
      if (hit) return { lat: hit.lat, lng: hit.lng };
    } catch {
      /* fallback */
    }
  }
  const nom = await nominatimSearch(label);
  return nom ? { lat: nom.lat, lng: nom.lng } : null;
}

export async function resolveCoordinatesToAddress(lat, lng) {
  try {
    const data = await api('/dadata/geolocate', { method: 'POST', body: { lat, lng } });
    if (data?.value) return data.value;
  } catch {
    /* fallback */
  }
  return nominatimReverse(lat, lng);
}
