/* global ol */
import { marsDate } from "./marsdate.js";
import { LANDING_SITES, REGIONS, nearest } from "./features.js";

const GLOBAL_EXTENT = [-180, -90, 180, 90];
const $ = (id) => document.getElementById(id);

// ---------- State ----------
const state = {
  days: [],          // manifest entries, sorted by date
  index: -1,         // current index into days (-1 if no manifest data)
  date: null,        // current Date (UTC midnight)
  lonMode: 180,
  playing: false,
  timer: null,
};

// ---------- Projection & tile grids ----------
const proj = ol.proj.get("EPSG:4326");
const trekResolutions = Array.from({ length: 10 }, (_, z) => 180 / 256 / 2 ** z);
const trekGrid = new ol.tilegrid.TileGrid({
  extent: GLOBAL_EXTENT,
  origin: [-180, 90],
  resolutions: trekResolutions,
  tileSize: 256,
});

function trekLayer(layerId, maxZoom, attribution) {
  return new ol.layer.Tile({
    source: new ol.source.XYZ({
      projection: proj,
      tileGrid: trekGrid,
      maxZoom,
      wrapX: false,
      attributions: attribution,
      tileUrlFunction: ([z, x, y]) =>
        `https://trek.nasa.gov/tiles/Mars/EQ/${layerId}/1.0.0/default/default028mm/${z}/${y}/${x}.jpg`,
    }),
  });
}

const basemaps = {
  viking: trekLayer("Mars_Viking_MDIM21_ClrMosaic_global_232m", 7, "Viking MDIM 2.1 · USGS/NASA Ames · Mars Trek"),
  mola: trekLayer("Mars_MGS_MOLA_ClrShade_merge_global_463m", 7, "MGS MOLA shaded relief · Mars Trek"),
};

// ---------- MDGM layer ----------
const mdgmLayer = new ol.layer.Image({ opacity: 1 });
const sourceCache = new Map();

function mdgmSource(day) {
  if (!sourceCache.has(day.date)) {
    sourceCache.set(
      day.date,
      new ol.source.ImageStatic({
        url: day.url,
        imageExtent: day.extent || GLOBAL_EXTENT,
        projection: proj,
        interpolate: true,
        attributions: "MARCI MDGM v2 · H. Wang et al. (SAO) · MSSS/NASA",
      })
    );
  }
  return sourceCache.get(day.date);
}

function preload(fromIndex, count = 4) {
  for (let i = 1; i <= count; i++) {
    const d = state.days[fromIndex + i];
    if (d) new Image().src = d.url;
  }
}

// ---------- Overlays ----------
const siteStyle = (f) =>
  new ol.style.Style({
    image: new ol.style.Circle({
      radius: 4.5,
      fill: new ol.style.Fill({ color: "#e7c892" }),
      stroke: new ol.style.Stroke({ color: "#000000", width: 1.5 }),
    }),
    text: new ol.style.Text({
      text: f.get("name"),
      font: "500 12px Outfit, sans-serif",
      offsetY: -12,
      fill: new ol.style.Fill({ color: "#ffffff" }),
      stroke: new ol.style.Stroke({ color: "rgba(0,0,0,.8)", width: 3 }),
    }),
  });

const regionStyle = (f) =>
  new ol.style.Style({
    text: new ol.style.Text({
      text: f.get("name").toUpperCase(),
      font: "500 10px IBM Plex Mono, monospace",
      fill: new ol.style.Fill({ color: "rgba(189,238,251,.9)" }),
      stroke: new ol.style.Stroke({ color: "rgba(0,0,0,.7)", width: 3 }),
      // letter-spacing is not supported by canvas text in all browsers; keep simple
    }),
  });

function pointLayer(list, style, kind) {
  return new ol.layer.Vector({
    source: new ol.source.Vector({
      features: list.map(
        (p) => new ol.Feature({ geometry: new ol.geom.Point([p.lon, p.lat]), kind, ...p })
      ),
    }),
    style,
    declutter: true,
  });
}

const sitesLayer = pointLayer(LANDING_SITES, siteStyle, "site");
const regionsLayer = pointLayer(REGIONS, regionStyle, "region");
const gridLayer = new ol.layer.Graticule({
  strokeStyle: new ol.style.Stroke({ color: "rgba(255,255,255,0.18)", width: 1 }),
  showLabels: true,
  wrapX: false,
  lonLabelStyle: new ol.style.Text({ font: "10px IBM Plex Mono, monospace", fill: new ol.style.Fill({ color: "#aaa" }), textBaseline: "bottom", stroke: new ol.style.Stroke({ color: "#000", width: 3 }) }),
  latLabelStyle: new ol.style.Text({ font: "10px IBM Plex Mono, monospace", fill: new ol.style.Fill({ color: "#aaa" }), textAlign: "end", stroke: new ol.style.Stroke({ color: "#000", width: 3 }) }),
  lonLabelFormatter: (lon) => fmtLon(lon),
  latLabelFormatter: (lat) => `${Math.abs(lat)}°${lat >= 0 ? "N" : "S"}`,
  visible: false,
});

// ---------- Map ----------
const map = new ol.Map({
  target: "map",
  layers: [basemaps.viking, basemaps.mola, mdgmLayer, gridLayer, regionsLayer, sitesLayer],
  controls: ol.control.defaults.defaults({ zoom: false, rotate: false, attributionOptions: { collapsible: false } }),
  view: new ol.View({
    projection: proj,
    center: [0, 0],
    zoom: 1,
    minZoom: 0,
    maxZoom: 9,
    extent: GLOBAL_EXTENT,
    constrainOnlyCenter: false,
    showFullExtent: true,
    smoothExtentConstraint: true,
  }),
});
basemaps.mola.setVisible(false);
map.getView().fit(GLOBAL_EXTENT, { padding: [20, 20, 130, 280] });

// ---------- Formatting ----------
function fmtLon(lon) {
  if (state.lonMode === 360) return `${(((lon % 360) + 360) % 360).toFixed(0)}°E`;
  return `${Math.abs(lon).toFixed(0)}°${lon >= 0 ? "E" : "W"}`;
}
function fmtLonPrecise(lon) {
  return state.lonMode === 360 ? `${(((lon % 360) + 360) % 360).toFixed(2)}°E` : `${lon.toFixed(2)}°E`;
}
const fmtLat = (lat) => `${lat.toFixed(2)}°`;
const isoDate = (d) => d.toISOString().slice(0, 10);
const parseDate = (s) => new Date(`${s}T00:00:00Z`);

// ---------- Date handling ----------
function setDay(i) {
  if (!state.days.length) return;
  state.index = Math.max(0, Math.min(state.days.length - 1, i));
  const day = state.days[state.index];
  state.date = parseDate(day.date);
  mdgmLayer.setSource(mdgmSource(day));
  preload(state.index);
  $("day-slider").value = state.index;
  updateDateUI();
}

function setDate(date) {
  state.date = date;
  if (state.days.length) {
    // snap to nearest available day
    const t = date.getTime();
    let best = 0;
    for (let i = 0; i < state.days.length; i++) {
      if (Math.abs(parseDate(state.days[i].date) - t) < Math.abs(parseDate(state.days[best].date) - t)) best = i;
    }
    setDay(best);
    return;
  }
  updateDateUI();
}

function updateDateUI() {
  const d = state.date;
  const m = marsDate(new Date(d.getTime() + 12 * 3600e3)); // evaluate mid-day UTC
  $("date").value = isoDate(d);
  $("md-my").textContent = `MY ${m.my}`;
  $("md-ls").textContent = `Ls ${m.ls.toFixed(1)}°`;
  $("md-season").textContent = m.season;
  $("ls-marker").style.left = `${(m.ls / 360) * 100}%`;
  renderAvailability(m.my);
  writeHash();
}

function renderAvailability(my) {
  const el = $("ls-avail");
  el.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const day of state.days) {
    if (day.my !== my) continue;
    const i = document.createElement("i");
    i.style.left = `${(day.ls / 360) * 100}%`;
    frag.appendChild(i);
  }
  el.appendChild(frag);
}

function step(delta) {
  if (state.days.length) setDay(state.index + delta);
  else setDate(new Date(state.date.getTime() + delta * 86400e3));
}

function togglePlay(force) {
  state.playing = force ?? !state.playing;
  $("play").textContent = state.playing ? "❚❚" : "▶";
  $("play").classList.toggle("playing", state.playing);
  clearInterval(state.timer);
  if (state.playing) {
    state.timer = setInterval(() => {
      if (state.days.length && state.index >= state.days.length - 1) setDay(0);
      else step(1);
    }, Number($("speed").value));
  }
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
  const status = $("mdgm-status");
  const slider = $("day-slider");
  if (state.days.length) {
    slider.max = state.days.length - 1;
    slider.disabled = false;
    const a = state.days[0].date, b = state.days.at(-1).date;
    status.textContent = `${state.days.length} daily maps · ${a} → ${b}`;
    $("date").min = a;
    $("date").max = b;
  } else {
    slider.disabled = true;
    status.textContent = "No daily maps loaded yet. Run tools/prepare_mdgm.py to add Wang MDGM JPEGs. The Mars calendar still works for any date.";
    status.classList.add("warn");
  }
}

// ---------- URL hash state ----------
function writeHash() {
  if (!state.date) return;
  const v = map.getView();
  const c = v.getCenter() || [0, 0];
  const params = new URLSearchParams({
    d: isoDate(state.date),
    c: `${c[0].toFixed(2)},${c[1].toFixed(2)}`,
    z: (v.getZoom() ?? 1).toFixed(2),
    b: document.querySelector('input[name="base"]:checked').value,
  });
  history.replaceState(null, "", `#${params}`);
}

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.get("b")) {
    const r = document.querySelector(`input[name="base"][value="${p.get("b")}"]`);
    if (r) { r.checked = true; setBase(r.value); }
  }
  if (p.get("c") && p.get("z")) {
    const [x, y] = p.get("c").split(",").map(Number);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      map.getView().setCenter([x, y]);
      map.getView().setZoom(Number(p.get("z")));
    }
  }
  return p.get("d");
}

// ---------- UI wiring ----------
function setBase(value) {
  basemaps.viking.setVisible(value === "viking");
  basemaps.mola.setVisible(value === "mola");
  writeHash();
}

function wire() {
  $("lyr-mdgm").addEventListener("change", (e) => mdgmLayer.setVisible(e.target.checked));
  $("mdgm-opacity").addEventListener("input", (e) => mdgmLayer.setOpacity(Number(e.target.value)));
  $("lyr-sites").addEventListener("change", (e) => sitesLayer.setVisible(e.target.checked));
  $("lyr-regions").addEventListener("change", (e) => regionsLayer.setVisible(e.target.checked));
  $("lyr-grid").addEventListener("change", (e) => gridLayer.setVisible(e.target.checked));
  document.querySelectorAll('input[name="base"]').forEach((r) => r.addEventListener("change", () => setBase(r.value)));

  document.querySelectorAll(".lon-mode button").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll(".lon-mode button").forEach((x) => x.classList.toggle("active", x === b));
      state.lonMode = Number(b.dataset.lon);
      gridLayer.changed();
      map.render();
    })
  );

  $("prev").addEventListener("click", () => step(-1));
  $("next").addEventListener("click", () => step(1));
  $("play").addEventListener("click", () => togglePlay());
  $("speed").addEventListener("change", () => state.playing && togglePlay(true));
  $("day-slider").addEventListener("input", (e) => setDay(Number(e.target.value)));
  $("date").addEventListener("change", (e) => e.target.value && setDate(parseDate(e.target.value)));

  $("share").addEventListener("click", async () => {
    writeHash();
    try {
      await navigator.clipboard.writeText(location.href);
      $("share").textContent = "Copied ✓";
    } catch {
      $("share").textContent = "Copy from address bar";
    }
    setTimeout(() => ($("share").textContent = "Copy link"), 1600);
  });

  document.querySelectorAll("[data-view]").forEach((t) => t.addEventListener("click", () => showView(t.dataset.view)));

  $("theme-tog").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("sirenum-theme", next); } catch {}
  });

  const tick = () => ($("ts").textContent = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC");
  tick();
  setInterval(tick, 30000);

  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input[type=date], select")) return;
    if (e.key === "ArrowLeft") { step(-1); e.preventDefault(); }
    else if (e.key === "ArrowRight") { step(1); e.preventDefault(); }
    else if (e.key === " ") { togglePlay(); e.preventDefault(); }
    else if (e.key === "1") showView("map");
    else if (e.key === "2") showView("about");
  });

  map.on("pointermove", (e) => {
    const [lon, lat] = e.coordinate;
    $("cursor").textContent =
      Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? `${fmtLat(lat)}  ${fmtLonPrecise(lon)}` : "";
  });
  map.getViewport().addEventListener("mouseleave", () => ($("cursor").textContent = ""));
  map.on("moveend", writeHash);
  map.on("singleclick", (e) => showDetails(e.coordinate, e.pixel));
  $("details-close").addEventListener("click", () => $("details").classList.add("hidden"));
}

function showView(name) {
  document.querySelectorAll("[data-view]").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
  if (name === "map") map.updateSize();
}

function showDetails([lon, lat], pixel) {
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
  let title = "Location";
  const hit = map.forEachFeatureAtPixel(pixel, (f) => f, { hitTolerance: 6 });
  if (hit && hit.get("kind") === "site") {
    title = hit.get("name");
    [lon, lat] = hit.getGeometry().getCoordinates();
  }
  const site = nearest(LANDING_SITES, lat, lon);
  const region = nearest(REGIONS, lat, lon);
  const m = state.date ? marsDate(new Date(state.date.getTime() + 12 * 3600e3)) : null;
  const day = state.days[state.index];
  const rows = [
    ["Latitude", fmtLat(lat)],
    ["Longitude", fmtLonPrecise(lon)],
    ["Nearest region", `${region.name}`],
    ["", `${Math.round(region.km).toLocaleString()} km`],
    ["Nearest lander", site.name],
    ["", `${Math.round(site.km).toLocaleString()} km`],
  ];
  if (hit && hit.get("kind") === "site") rows.push(["Landed", `${hit.get("year")} · ${hit.get("agency")}`]);
  if (m) rows.push(["Date", `${isoDate(state.date)}`], ["Mars date", `MY ${m.my} · Ls ${m.ls.toFixed(1)}°`]);
  rows.push(["Daily map", day ? `${day.subphase ? day.subphase + " · " : ""}${day.date}` : "none"]);
  $("details-title").textContent = title;
  $("details-body").innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
  $("details").classList.remove("hidden");
}

// ---------- Boot ----------
(async function init() {
  wire();
  await loadManifest();
  const hashDate = readHash();
  if (hashDate) setDate(parseDate(hashDate));
  else if (state.days.length) setDay(state.days.length - 1);
  else {
    const n = new Date(); // today in the viewer's local calendar
    setDate(new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())));
  }
})();
