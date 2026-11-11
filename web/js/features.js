// Reference features. Planetocentric latitude, east-positive longitude in -180..180.
// Landing coordinates are approximate (~0.1 deg), plenty for a 0.1 deg/px daily map.
// landed / ended are UTC dates (ended = last contact; null = still active).

export const LANDING_SITES = [
  { name: "Viking 1", lat: 22.27, lon: -47.95, landed: "1976-07-20", ended: "1982-11-11", agency: "NASA" },
  { name: "Viking 2", lat: 47.64, lon: 134.29, landed: "1976-09-03", ended: "1980-04-11", agency: "NASA" },
  { name: "Mars Pathfinder", lat: 19.13, lon: -33.22, landed: "1997-07-04", ended: "1997-09-27", agency: "NASA" },
  { name: "Spirit", lat: -14.57, lon: 175.47, landed: "2004-01-04", ended: "2010-03-22", agency: "NASA" },
  { name: "Opportunity", lat: -1.95, lon: -5.53, landed: "2004-01-25", ended: "2018-06-10", agency: "NASA" },
  { name: "Phoenix", lat: 68.22, lon: -125.75, landed: "2008-05-25", ended: "2008-11-02", agency: "NASA" },
  { name: "Curiosity", lat: -4.59, lon: 137.44, landed: "2012-08-06", ended: null, agency: "NASA" },
  { name: "InSight", lat: 4.5, lon: 135.62, landed: "2018-11-26", ended: "2022-12-15", agency: "NASA" },
  { name: "Perseverance", lat: 18.44, lon: 77.45, landed: "2021-02-18", ended: null, agency: "NASA" },
  { name: "Zhurong", lat: 25.07, lon: 109.93, landed: "2021-05-14", ended: "2022-05-20", agency: "CNSA" },
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
  { name: "Planum Boreum", lat: 85, lon: 15 },
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
