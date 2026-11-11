// Timeline markers.
// SEASONAL repeat every Mars year at a fixed solar longitude.
// DATED are one-off events on a UTC date (lat/lon when the event has a place).

export const SEASONAL = [
  { ls: 0, label: "Northern spring equinox", c: "#5fa08a" },
  { ls: 71, label: "Aphelion", c: "#9fb7d6" },
  { ls: 90, label: "Northern summer solstice", c: "#d6b452" },
  { ls: 180, label: "Dust season begins", c: "#d9783f" },
  { ls: 251, label: "Perihelion", c: "#ef6461" },
  { ls: 270, label: "Southern summer solstice", c: "#b5524a" },
];

export const DATED = [
  { date: "2006-11-08", label: "MRO primary science begins", c: "#5b8af5" },
  { date: "2008-05-25", label: "Phoenix lands", c: "#f0b429", lat: 68.22, lon: -125.75 },
  { date: "2008-11-02", label: "Phoenix last signal", c: "#8a93a6", lat: 68.22, lon: -125.75 },
  { date: "2010-03-22", label: "Spirit last contact", c: "#8a93a6", lat: -14.57, lon: 175.47 },
  { date: "2012-08-06", label: "Curiosity lands", c: "#f0b429", lat: -4.59, lon: 137.44 },
  { date: "2018-05-30", label: "2018 global dust storm begins", c: "#ef6461" },
  { date: "2018-06-10", label: "Opportunity last contact", c: "#8a93a6", lat: -1.95, lon: -5.53 },
  { date: "2018-11-26", label: "InSight lands", c: "#f0b429", lat: 4.5, lon: 135.62 },
  { date: "2021-02-18", label: "Perseverance lands", c: "#f0b429", lat: 18.44, lon: 77.45 },
  { date: "2021-05-14", label: "Zhurong lands", c: "#f0b429", lat: 25.07, lon: 109.93 },
];

// Season phases shown in the info card, by Ls.
export const PHASES = [
  { from: 0, to: 40, name: "Early northern spring", c: "#5fa08a",
    text: "The north seasonal CO₂ cap is retreating and the atmosphere is relatively clear of dust." },
  { from: 40, to: 150, name: "Aphelion cloud season", c: "#d6b452",
    text: "Mars is near aphelion (Ls 71°). Water-ice clouds build a belt over the tropics and cap the Tharsis volcanoes each afternoon." },
  { from: 150, to: 180, name: "Late northern summer", c: "#d6b452",
    text: "The aphelion cloud belt fades, and the edge of the south polar cap comes back into sunlight." },
  { from: 180, to: 250, name: "Dust storm season", c: "#d9783f",
    text: "Mars heads toward perihelion (Ls 251°). Regional dust storms become common along the south cap edge and in the southern lowlands." },
  { from: 250, to: 320, name: "Peak dust season", c: "#b5524a",
    text: "Around perihelion and the southern summer solstice (Ls 270°), regional and planet-encircling dust storms are most likely." },
  { from: 320, to: 360, name: "Late southern summer", c: "#b5524a",
    text: "Dust activity winds down and the north polar hood clouds thicken ahead of northern spring." },
];

export const phaseFor = (ls) => PHASES.find((p) => ls >= p.from && ls < p.to) || PHASES[0];
