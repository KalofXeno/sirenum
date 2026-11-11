/* global ol */
import { marsDate, solarLongitude, marsYear } from "./marsdate.js";
import { LANDING_SITES, REGIONS, nearest } from "./features.js";
import { SEASONAL, DATED, phaseFor } from "./events.js";

const GLOBAL_EXTENT = [-180, -90, 180, 90];
const DAY = 86400e3;
const $ = (id) => document.getElementById(id);
const isoDate = (d) => d.toISOString().slice(0, 10);
const parseDate = (s) => new Date(`${s}T00:00:00Z`);
const noon = (d) => new Date(d.getTime() + DAY / 2);
const phone = window.matchMedia("(max-width: 760px)");

// ---------- State ----------
const state = {
  days: [],            // manifest entries, sorted
  byDate: new Map(),   // iso -> index
  date: null,          // current UTC midnight
  lonMode: 180,
  speed: 400,
  playing: false,
  timer: null,
};

// ---------- Tile grids & basemaps ----------
const proj = ol.proj.get("EPSG:4326");
const trekGrid = new ol.tilegrid.TileGrid({
  extent: GLOBAL_EXTENT,
  origin: [-180, 90],
  resolutions: Array.from({ length: 10 }, (_, z) => 180 / 256 / 2 ** z),
  tileSize: 256,
});

function trekLayer(layerId, maxZoom, attribution) {
  return new ol.layer.Tile({
    source: new ol.source.XYZ({
      projection: proj, tileGrid: trekGrid, maxZoom, wrapX: false, attributions: attribution,
      tileUrlFunction: ([z, x, y]) =>
        `https://trek.nasa.gov/tiles/Mars/EQ/${layerId}/1.0.0/default/default028mm/${z}/${y}/${x}.jpg`,
    }),
  });
}
const basemaps = {
  viking: trekLayer("Mars_Viking_MDIM21_ClrMosaic_global_232m", 7, "Viking MDIM 2.1 · USGS/NASA Ames · Mars Trek"),
  mola: trekLayer("Mars_MGS_MOLA_ClrShade_merge_global_463m", 7, "MGS MOLA · Mars Trek"),
};

// ---------- Daily maps ----------
const MDGM_ATTR = "MARCI MDGM v2 · H. Wang et al. (SAO) · MSSS/NASA";
const mdgmTileLayer = new ol.layer.Tile({ preload: 1 });
const mdgmImageLayer = new ol.layer.Image();
const mdgmLayers = [mdgmTileLayer, mdgmImageLayer];
const sourceCache = new Map();
const tileUrl = (t, z, y, x) => t.replace("{z}", z).replace("{y}", y).replace("{x}", x);

function mdgmSource(day) {
  if (!sourceCache.has(day.date)) {
    sourceCache.set(day.date, day.tiles
      ? new ol.source.XYZ({
          projection: proj, tileGrid: trekGrid, maxZoom: day.maxZoom ?? 3, wrapX: false, transition: 0,
          attributions: MDGM_ATTR, tileUrlFunction: ([z, x, y]) => tileUrl(day.tiles, z, y, x),
        })
      : new ol.source.ImageStatic({
          url: day.url, imageExtent: day.extent || GLOBAL_EXTENT, projection: proj, attributions: MDGM_ATTR,
        }));
  }
  return sourceCache.get(day.date);
}

function showDay(day) {
  const src = day ? mdgmSource(day) : null;
  mdgmTileLayer.setSource(day?.tiles ? src : null);
  mdgmImageLayer.setSource(day && !day.tiles ? src : null);
}

function preload(fromIndex, count = 4) {
  const z = Math.min(2, Math.max(0, Math.round(map.getView().getZoom() ?? 1) - 1));
  for (let i = 1; i <= count; i++) {
    const d = state.days[fromIndex + i];
    if (!d) continue;
    if (d.tiles) {
      for (let r = 0; r < 2 ** z; r++)
        for (let c = 0; c < 2 ** (z + 1); c++) new Image().src = tileUrl(d.tiles, z, r, c);
    } else if (d.url) new Image().src = d.url;
  }
}

// ---------- Vector overlays ----------
const regionsLayer = new ol.layer.Vector({
  source: new ol.source.Vector({
    features: REGIONS.map((p) => new ol.Feature({ geometry: new ol.geom.Point([p.lon, p.lat]), ...p })),
  }),
  declutter: true,
  style: (f) => new ol.style.Style({
    text: new ol.style.Text({
      text: f.get("name").toUpperCase(),
      font: "500 10px 'IBM Plex Mono', monospace",
      fill: new ol.style.Fill({ color: "rgba(255,255,255,.82)" }),
      stroke: new ol.style.Stroke({ color: "rgba(0,0,0,.65)", width: 3 }),
    }),
  }),
});

const labelText = (font, align, base) => new ol.style.Text({
  font, textAlign: align, textBaseline: base,
  fill: new ol.style.Fill({ color: "rgba(255,255,255,.7)" }),
  stroke: new ol.style.Stroke({ color: "rgba(0,0,0,.7)", width: 3 }),
});
const gridLayer = new ol.layer.Graticule({
  strokeStyle: new ol.style.Stroke({ color: "rgba(255,255,255,0.2)", width: 1 }),
  showLabels: true, wrapX: false, visible: false,
  lonLabelStyle: labelText("10px 'IBM Plex Mono', monospace", "center", "bottom"),
  latLabelStyle: labelText("10px 'IBM Plex Mono', monospace", "end", "middle"),
  lonLabelFormatter: (lon) => fmtLon(lon),
  latLabelFormatter: (lat) => `${Math.abs(lat)}°${lat >= 0 ? "N" : "S"}`,
});

// ---------- Map ----------
const map = new ol.Map({
  target: "map",
  layers: [basemaps.viking, basemaps.mola, ...mdgmLayers, gridLayer, regionsLayer],
  controls: ol.control.defaults.defaults({ zoom: false, rotate: false, attributionOptions: { collapsible: false } }),
  view: new ol.View({
    projection: proj, center: [0, 0], zoom: 1, minZoom: 0, maxZoom: 9,
    extent: GLOBAL_EXTENT, constrainOnlyCenter: false, showFullExtent: true, smoothExtentConstraint: true,
  }),
});
basemaps.mola.setVisible(false);
window.sirenum = { map, state }; // handle for console debugging

// Landing sites as HTML pills (only shown once a lander has landed).
const sitePins = LANDING_SITES.map((s) => {
  const el = document.createElement("div");
  el.className = "site-pin";
  el.textContent = s.name;
  el.addEventListener("click", (e) => { e.stopPropagation(); showDetails([s.lon, s.lat], s); });
  const ov = new ol.Overlay({ element: el, position: [s.lon, s.lat], positioning: "center-left", stopEvent: false });
  map.addOverlay(ov);
  return { site: s, el };
});

function updatePins() {
  const t = state.date?.getTime() ?? Date.now();
  for (const { site, el } of sitePins) {
    const landed = parseDate(site.landed).getTime() <= t;
    const ended = site.ended && parseDate(site.ended).getTime() < t;
    el.style.display = landed ? "" : "none";
    el.style.opacity = ended ? ".55" : "1";
    el.title = `${site.name} · landed ${site.landed}${site.ended ? ` · last contact ${site.ended}` : " · active"}`;
  }
}

// ---------- Layout helpers ----------
function dockHeight() { return $("dock").offsetHeight || 150; }
new ResizeObserver(() => {
  document.documentElement.style.setProperty("--dock-h", `${dockHeight()}px`);
}).observe($("dock"));

function fitInitial() {
  const v = map.getView();
  const size = map.getSize() || [innerWidth, innerHeight];
  if (phone.matches) {
    const top = $("info").offsetHeight + 24;
    v.setResolution(180 / Math.max(200, size[1] - top - dockHeight() - 24));
    v.setCenter([0, 0]);
  } else {
    v.fit(GLOBAL_EXTENT, { padding: [20, 64, dockHeight() + 40, 64] });
  }
}

// ---------- Formatting ----------
function fmtLon(lon) {
  if (state.lonMode === 360) return `${(((lon % 360) + 360) % 360).toFixed(0)}°E`;
  return `${Math.abs(lon).toFixed(0)}°${lon >= 0 ? "E" : "W"}`;
}
const fmtLonPrecise = (lon) =>
  state.lonMode === 360 ? `${(((lon % 360) + 360) % 360).toFixed(2)}°E` : `${lon.toFixed(2)}°E`;
const fmtLat = (lat) => `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"}`;
const dayLabel = (d) => (d?.subphase ? `${d.subphase}${d.day ? ` · Day ${String(d.day).padStart(2, "0")}` : ""}` : "");

// ---------- Mars-year calendar (for scrubbing and seasonal events) ----------
const yearCache = new Map();
function marsYearDays(my) {
  if (!yearCache.has(my)) {
    const approxStart = parseDate("1955-04-11").getTime() + (my - 1) * 686.9726 * DAY;
    const out = [];
    for (let t = approxStart - 8 * DAY; t < approxStart + 700 * DAY; t += DAY) {
      const d = new Date(t);
      const n = noon(d);
      if (marsYear(n) === my) out.push({ date: d, ls: solarLongitude(n) });
    }
    yearCache.set(my, out);
  }
  return yearCache.get(my);
}
function dateForLs(my, ls) {
  let best = null;
  for (const e of marsYearDays(my)) if (!best || Math.abs(e.ls - ls) < Math.abs(best.ls - ls)) best = e;
  return best.date;
}

// ---------- Date handling ----------
function currentIndex() { return state.date ? state.byDate.get(isoDate(state.date)) ?? -1 : -1; }

function setDate(date, { snapDays = 0 } = {}) {
  let d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  if (snapDays && state.days.length && !state.byDate.has(isoDate(d))) {
    let best = null;
    for (const day of state.days) {
      const dt = Math.abs(parseDate(day.date) - d) / DAY;
      if (dt <= snapDays && (!best || dt < best.dt)) best = { day, dt };
    }
    if (best) d = parseDate(best.day.date);
  }
  state.date = d;
  const idx = currentIndex();
  showDay(idx >= 0 ? state.days[idx] : null);
  if (idx >= 0) preload(idx);
  render();
}

function step(delta) {
  if (!state.days.length) return setDate(new Date(state.date.getTime() + delta * DAY));
  const idx = currentIndex();
  if (idx >= 0) {
    const n = idx + delta;
    if (n < 0 || n >= state.days.length) return toast(delta > 0 ? "Last daily map loaded" : "First daily map loaded");
    return setDate(parseDate(state.days[n].date));
  }
  // off a map day: go to the nearest available day in that direction
  const t = state.date.getTime();
  const pool = delta > 0 ? state.days.filter((d) => parseDate(d.date) > t) : state.days.filter((d) => parseDate(d.date) < t).reverse();
  if (!pool.length) return toast("No daily maps in that direction yet");
  setDate(parseDate(pool[0].date));
}

function togglePlay(force) {
  state.playing = force ?? !state.playing;
  $("play").classList.toggle("playing", state.playing);
  clearInterval(state.timer);
  if (!state.playing || !state.days.length) return;
  if (currentIndex() < 0) setDate(parseDate(state.days[0].date));
  state.timer = setInterval(() => {
    const idx = currentIndex();
    setDate(parseDate(state.days[idx >= state.days.length - 1 || idx < 0 ? 0 : idx + 1].date));
  }, state.speed);
}

function setSpeed(ms) {
  state.speed = ms;
  document.querySelectorAll("#speed-seg button").forEach((b) => b.classList.toggle("active", Number(b.dataset.speed) === ms));
  if (state.playing) togglePlay(true);
}

// ---------- Rendering ----------
function render() {
  const m = marsDate(noon(state.date));
  const idx = currentIndex();
  const day = idx >= 0 ? state.days[idx] : null;
  const phase = phaseFor(m.ls);

  // info card
  $("info-eyebrow").textContent = `MY ${m.my} · Ls ${m.ls.toFixed(1)}° · ${m.season}`;
  $("info-dot").style.background = phase.c;
  $("info-title").textContent = day ? `${phase.name} · ${dayLabel(day) || isoDate(state.date)}` : `${phase.name} · no map yet`;
  $("info-text").textContent = day
    ? phase.text
    : `${phase.text} No MARCI daily map is loaded for ${isoDate(state.date)} yet.`;

  // dock stats
  $("stat-ls").textContent = `${m.ls.toFixed(1)}°`;
  $("stat-date").textContent = isoDate(state.date);
  $("stat-my").textContent = `MY ${m.my}${day ? ` · ${dayLabel(day)}` : ` · sol ${Math.floor(m.msd)}`}`;
  $("date").value = isoDate(state.date);
  $("thumb").style.left = `${(m.ls / 360) * 100}%`;
  $("scrub").setAttribute("aria-valuenow", m.ls.toFixed(1));
  $("scrub").setAttribute("aria-valuetext", `Ls ${m.ls.toFixed(1)} degrees, ${isoDate(state.date)}`);

  renderTimeline(m.my);
  updatePins();
  writeHash();
}

function renderTimeline(my) {
  const showEvents = $("lyr-events").checked;
  const marks = [];
  const t = state.date.getTime();
  // available daily maps in this Mars year
  for (const d of state.days) {
    if (d.my !== my) continue;
    marks.push(`<i class="day${d.date === isoDate(state.date) ? " current" : ""}" style="left:${(d.ls / 360) * 100}%" title="${d.date}"></i>`);
  }
  const chips = [];
  if (showEvents) {
    const items = [
      ...SEASONAL.map((e) => ({ ...e, date: dateForLs(my, e.ls) })),
      ...DATED.map((e) => ({ ...e, date: parseDate(e.date) }))
        .filter((e) => marsYear(noon(e.date)) === my)
        .map((e) => ({ ...e, ls: solarLongitude(noon(e.date)) })),
    ].sort((a, b) => a.ls - b.ls);
    for (const e of items) {
      marks.push(`<i style="left:${(e.ls / 360) * 100}%;--c:${e.c}" title="${e.label} · ${isoDate(e.date)}"></i>`);
      const near = Math.abs(e.date - t) <= 2 * DAY;
      chips.push(`<button class="chip${near ? " near" : ""}" style="--c:${e.c}" data-date="${isoDate(e.date)}"${e.lat != null ? ` data-lat="${e.lat}" data-lon="${e.lon}"` : ""} title="Ls ${e.ls.toFixed(1)}° · ${isoDate(e.date)}">${e.label}</button>`);
    }
  }
  $("marks").innerHTML = marks.join("");
  $("chips").innerHTML = chips.join("");
}

let toastTimer;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  $("hint").classList.add("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.add("hidden"); $("hint").classList.remove("hidden"); }, 1800);
}

// ---------- Manifest ----------
async function loadManifest() {
  try {
    const res = await fetch("data/manifest.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status);
    const m = await res.json();
    state.days = (m.days || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  } catch (e) {
    console.warn("No manifest", e);
    state.days = [];
  }
  state.byDate = new Map(state.days.map((d, i) => [d.date, i]));
  const n = state.days.length;
  $("mdgm-status").textContent = n
    ? `${n} daily map${n === 1 ? "" : "s"} · ${state.days[0].date}${n > 1 ? ` → ${state.days.at(-1).date}` : ""}`
    : "No daily maps loaded yet.";
}

// ---------- URL hash ----------
function writeHash() {
  if (!state.date) return;
  const v = map.getView();
  const c = v.getCenter() || [0, 0];
  const base = document.querySelector("#base-seg .active")?.dataset.base || "viking";
  const p = new URLSearchParams({ d: isoDate(state.date), c: `${c[0].toFixed(2)},${c[1].toFixed(2)}`, z: (v.getZoom() ?? 1).toFixed(2), b: base });
  history.replaceState(null, "", `#${p}`);
}
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.get("b")) setBase(p.get("b"));
  if (p.get("c") && p.get("z")) {
    const [x, y] = p.get("c").split(",").map(Number);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      map.getView().setCenter([x, y]);
      map.getView().setZoom(Number(p.get("z")));
    }
  }
  return p.get("d");
}

// ---------- Settings ----------
function setBase(value) {
  basemaps.viking.setVisible(value === "viking");
  basemaps.mola.setVisible(value === "mola");
  document.querySelectorAll("#base-seg button").forEach((b) => b.classList.toggle("active", b.dataset.base === value));
  writeHash();
}
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem("sirenum-theme", t); } catch {}
  document.querySelectorAll("#theme-seg button").forEach((b) => b.classList.toggle("active", b.dataset.themeSet === t));
}
function setDrawer(open) {
  $("drawer").classList.toggle("open", open);
  $("settings-btn").setAttribute("aria-expanded", String(open));
  if (open) $("details").classList.add("hidden");
}

// ---------- Details ----------
function showDetails([lon, lat], site = null) {
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
  setDrawer(false);
  const region = nearest(REGIONS, lat, lon);
  const lander = nearest(LANDING_SITES.filter((s) => parseDate(s.landed) <= state.date), lat, lon);
  const m = marsDate(noon(state.date));
  const idx = currentIndex();
  const rows = [
    ["Latitude", fmtLat(lat)],
    ["Longitude", fmtLonPrecise(lon)],
    ["Nearest region", region.name],
    ["", `${Math.round(region.km).toLocaleString()} km`],
  ];
  if (site) rows.push(["Landed", site.landed], ["Status", site.ended && parseDate(site.ended) < state.date ? `last contact ${site.ended}` : "active"]);
  else if (lander) rows.push(["Nearest lander", lander.name], ["", `${Math.round(lander.km).toLocaleString()} km`]);
  rows.push(["Date", isoDate(state.date)], ["Mars date", `MY ${m.my} · Ls ${m.ls.toFixed(1)}°`],
    ["Daily map", idx >= 0 ? dayLabel(state.days[idx]) || "yes" : "none"]);
  $("details-eyebrow").textContent = site ? `Lander · ${site.agency}` : "Location";
  $("details-title").textContent = site ? site.name : region.km < 400 ? region.name : `${fmtLat(lat)}, ${fmtLonPrecise(lon)}`;
  $("details-body").innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
  $("details").classList.remove("hidden");
}

// ---------- Wiring ----------
function wire() {
  // layers
  $("lyr-mdgm").addEventListener("change", (e) => mdgmLayers.forEach((l) => l.setVisible(e.target.checked)));
  $("mdgm-opacity").addEventListener("input", (e) => mdgmLayers.forEach((l) => l.setOpacity(Number(e.target.value))));
  $("lyr-sites").addEventListener("change", (e) => document.body.classList.toggle("sites-off", !e.target.checked));
  $("lyr-regions").addEventListener("change", (e) => regionsLayer.setVisible(e.target.checked));
  $("lyr-grid").addEventListener("change", (e) => gridLayer.setVisible(e.target.checked));
  $("lyr-events").addEventListener("change", () => render());
  document.querySelectorAll("#base-seg button").forEach((b) => b.addEventListener("click", () => setBase(b.dataset.base)));
  document.querySelectorAll("#theme-seg button").forEach((b) => b.addEventListener("click", () => setTheme(b.dataset.themeSet)));
  document.querySelectorAll("#lon-seg button").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("#lon-seg button").forEach((x) => x.classList.toggle("active", x === b));
    state.lonMode = Number(b.dataset.lon);
    gridLayer.changed();
  }));
  $("settings-btn").addEventListener("click", () => setDrawer(!$("drawer").classList.contains("open")));
  $("details-close").addEventListener("click", () => $("details").classList.add("hidden"));
  $("about-btn").addEventListener("click", () => { setDrawer(false); $("about").classList.remove("hidden"); });
  $("about-close").addEventListener("click", () => $("about").classList.add("hidden"));
  $("about").addEventListener("click", (e) => { if (e.target === $("about")) $("about").classList.add("hidden"); });
  $("share").addEventListener("click", async () => {
    writeHash();
    try { await navigator.clipboard.writeText(location.href); toast("Link copied"); }
    catch { toast("Copy the link from the address bar"); }
  });

  // zoom stack
  const zoomBy = (d) => { const v = map.getView(); v.animate({ zoom: (v.getZoom() ?? 1) + d, duration: 250 }); };
  $("zoom-in").addEventListener("click", () => zoomBy(1));
  $("zoom-out").addEventListener("click", () => zoomBy(-1));
  $("zoom-reset").addEventListener("click", () => fitInitial());

  // transport
  $("prev").addEventListener("click", () => step(-1));
  $("next").addEventListener("click", () => step(1));
  $("play").addEventListener("click", () => togglePlay());
  document.querySelectorAll("#speed-seg button").forEach((b) => b.addEventListener("click", () => setSpeed(Number(b.dataset.speed))));
  $("date").addEventListener("change", (e) => e.target.value && setDate(parseDate(e.target.value)));

  // season bar scrubbing (snaps to a daily map within 2 days)
  const scrub = $("scrub");
  const scrubTo = (clientX) => {
    const r = scrub.getBoundingClientRect();
    const ls = Math.min(359.9, Math.max(0, ((clientX - r.left) / r.width) * 360));
    setDate(dateForLs(marsYear(noon(state.date)), ls), { snapDays: 2 });
  };
  scrub.addEventListener("pointerdown", (e) => {
    scrub.setPointerCapture(e.pointerId);
    document.body.classList.add("scrubbing");
    togglePlay(false);
    scrubTo(e.clientX);
  });
  scrub.addEventListener("pointermove", (e) => { if (scrub.hasPointerCapture(e.pointerId)) scrubTo(e.clientX); });
  const endScrub = () => document.body.classList.remove("scrubbing");
  scrub.addEventListener("pointerup", endScrub);
  scrub.addEventListener("pointercancel", endScrub);
  scrub.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") { step(e.key === "ArrowRight" ? 1 : -1); e.preventDefault(); e.stopPropagation(); }
  });

  // event chips
  $("chips").addEventListener("click", (e) => {
    const c = e.target.closest(".chip");
    if (!c) return;
    togglePlay(false);
    setDate(parseDate(c.dataset.date), { snapDays: 2 });
    if (c.dataset.lat) map.getView().animate({ center: [Number(c.dataset.lon), Number(c.dataset.lat)], duration: 500 });
    if (currentIndex() < 0) toast(`No daily map for ${c.dataset.date} yet`);
  });

  // keyboard
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, select, textarea")) return;
    if (e.key === "ArrowLeft") { step(-1); e.preventDefault(); }
    else if (e.key === "ArrowRight") { step(1); e.preventDefault(); }
    else if (e.key === " ") { togglePlay(); e.preventDefault(); }
    else if (e.key === "1") setSpeed(900);
    else if (e.key === "2") setSpeed(400);
    else if (e.key === "3") setSpeed(150);
    else if (e.key === "Escape") { setDrawer(false); $("details").classList.add("hidden"); $("about").classList.add("hidden"); }
  });

  // map
  map.on("pointermove", (e) => {
    if (e.dragging) return;
    const [lon, lat] = e.coordinate;
    $("cursor").textContent = Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? `${fmtLat(lat)}  ${fmtLonPrecise(lon)}` : "";
  });
  map.getViewport().addEventListener("mouseleave", () => { $("cursor").textContent = ""; });
  map.on("moveend", () => { writeHash(); });
  map.on("singleclick", (e) => { showDetails(e.coordinate); });
  // OpenLayers stops an event when a listener returns false, so never return a value here.
  map.on("pointerdown", () => { setDrawer(false); });
  phone.addEventListener("change", () => { map.updateSize(); fitInitial(); });
  window.addEventListener("resize", () => { map.updateSize(); });
}

// ---------- Boot ----------
(async function init() {
  setTheme(document.documentElement.dataset.theme || "dark");
  wire();
  await loadManifest();
  document.documentElement.style.setProperty("--dock-h", `${dockHeight()}px`);
  fitInitial();
  const hashDate = readHash();
  if (hashDate) setDate(parseDate(hashDate));
  else if (state.days.length) setDate(parseDate(state.days.at(-1).date));
  else { const n = new Date(); setDate(new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()))); }
})();
