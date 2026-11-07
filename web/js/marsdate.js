// Mars calendar utilities.
// Algorithm: Allison & McEwen (2000), Planet. Space Sci. 48, 215-235, as used by Mars24.
// Mars Year numbering follows Clancy et al. (2000): MY 1 began at Ls 0 on 1955-04-11.

const DEG = Math.PI / 180;
const TT_MINUS_UTC_S = 69.184; // 37 leap seconds + 32.184 s (valid since 2017-01-01)

const PBS_TERMS = [
  // [A (deg), tau (Julian years), phi (deg)]
  [0.0071, 2.2353, 49.409],
  [0.0057, 2.7543, 168.173],
  [0.0039, 1.1177, 191.837],
  [0.0037, 15.7866, 21.736],
  [0.0021, 2.1354, 15.704],
  [0.0020, 2.4694, 95.528],
  [0.0018, 32.8493, 49.095],
];

const MARS_YEAR_DAYS = 686.9726;
// JD (TT) of the start of MY 1 (Ls = 0, 1955-04-11).
const MY1_START_JD = 2435208.5;

const mod360 = (x) => ((x % 360) + 360) % 360;

export function jdTT(date) {
  return date.getTime() / 86400000 + 2440587.5 + TT_MINUS_UTC_S / 86400;
}

export function solarLongitude(date) {
  const dt = jdTT(date) - 2451545.0;
  const M = (19.3871 + 0.52402073 * dt) * DEG;
  const alphaFMS = 270.3871 + 0.524038496 * dt;
  let pbs = 0;
  for (const [A, tau, phi] of PBS_TERMS) {
    pbs += A * Math.cos(((0.985626 * dt) / tau + phi) * DEG);
  }
  const eoc =
    (10.691 + 3.0e-7 * dt) * Math.sin(M) +
    0.623 * Math.sin(2 * M) +
    0.05 * Math.sin(3 * M) +
    0.005 * Math.sin(4 * M) +
    0.0005 * Math.sin(5 * M) +
    pbs;
  return mod360(alphaFMS + eoc);
}

export function marsSolDate(date) {
  return (jdTT(date) - 2405522.0028779) / 1.0274912517;
}

export function marsYear(date) {
  const ls = solarLongitude(date);
  const years = (jdTT(date) - MY1_START_JD) / MARS_YEAR_DAYS;
  let my = Math.floor(years) + 1;
  const frac = years - Math.floor(years);
  // The fixed-length year drifts slightly from true Ls 0; snap using Ls.
  if (frac < 0.1 && ls > 300) my -= 1;
  else if (frac > 0.9 && ls < 60) my += 1;
  return my;
}

export function season(ls) {
  const names = [
    "N. spring / S. autumn",
    "N. summer / S. winter",
    "N. autumn / S. spring",
    "N. winter / S. summer",
  ];
  return names[Math.floor(mod360(ls) / 90)];
}

export function isDustSeason(ls) {
  return ls >= 180 && ls < 360;
}

export function marsDate(date) {
  const ls = solarLongitude(date);
  return {
    ls,
    my: marsYear(date),
    msd: marsSolDate(date),
    season: season(ls),
    dustSeason: isDustSeason(ls),
  };
}
