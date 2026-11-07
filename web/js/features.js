// Reference features. Planetocentric latitude, east-positive longitude in -180..180.
// Landing site coordinates are approximate (to ~0.1 deg), sufficient for a 0.1 deg/px daily map.

export const LANDING_SITES = [
  { name: "Viking 1", lat: 22.27, lon: -47.95, year: 1976, agency: "NASA" },
  { name: "Viking 2", lat: 47.64, lon: 134.29, year: 1976, agency: "NASA" },
  { name: "Mars Pathfinder", lat: 19.13, lon: -33.22, year: 1997, agency: "NASA" },
  { name: "Spirit (MER-A)", lat: -14.57, lon: 175.47, year: 2004, agency: "NASA" },
  { name: "Opportunity (MER-B)", lat: -1.95, lon: -5.53, year: 2004, agency: "NASA" },
  { name: "Phoenix", lat: 68.22, lon: -125.75, year: 2008, agency: "NASA" },
  { name: "Curiosity (MSL)", lat: -4.59, lon: 137.44, year: 2012, agency: "NASA" },
  { name: "InSight", lat: 4.5, lon: 135.62, year: 2018, agency: "NASA" },
  { name: "Perseverance (M2020)", lat: 18.44, lon: 77.45, year: 2021, agency: "NASA" },
  { name: "Zhurong", lat: 25.07, lon: 109.93, year: 2021, agency: "CNSA" },
];

export const REGIONS = [
  { name: "Sirenum Terra", lat: -40, lon: -150 },
  { name: "Tharsis", lat: 2, lon: -110 },
  { name: "Olympus Mons", lat: 18.65, lon: -133.8 },
  { name: "Valles Marineris", lat: -14, lon: -59 },
  { name: "Arabia Terra", lat: 23, lon: 5 },
  { name: "Hellas Planitia", lat: -42.4, lon: 70.5 },
  { name: "Argyre Planitia", lat: -49.7, lon: -43.4 },
  { name: "Utopia Planitia", lat: 46.7, lon: 117.5 },
  { name: "Elysium Mons", lat: 25, lon: 147.2 },
  { name: "Acidalia Planitia", lat: 49.8, lon: -20.3 },
  { name: "Syrtis Major", lat: 8.4, lon: 69.5 },
  { name: "Amazonis Planitia", lat: 24.8, lon: -163.7 },
  { name: "Chryse Planitia", lat: 28.4, lon: -40.2 },
  { name: "Noachis Terra", lat: -45, lon: -10 },
  { name: "Planum Boreum", lat: 88, lon: 15 },
  { name: "Planum Australe", lat: -83.9, lon: 160 },
];

export const MARS_RADIUS_KM = 3396.19;

export function greatCircleKm(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLon = (lon2 - lon1) * r;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * MARS_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function nearest(list, lat, lon) {
  let best = null;
  for (const f of list) {
    const d = greatCircleKm(lat, lon, f.lat, f.lon);
    if (!best || d < best.km) best = { ...f, km: d };
  }
  return best;
}
