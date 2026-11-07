# Sirenum

Tools and a web viewer for Mars remote sensing, starting with **MRO MARCI Mars Daily Global Maps (MDGMs)**: a daily, Worldview-style look at Mars weather (dust storms, clouds, polar hoods) over 9+ Mars years.

**Live viewer:** https://kalofxeno.github.io/sirenum/

## Viewer (`web/`)

A static OpenLayers app with no build step.

- **Daily layer:** MARCI MDGM v2 color maps (simple cylindrical, 0.1°), driven by `web/data/manifest.json`
- **Timeline:** date picker, day stepping, playback, plus a Mars-year strip showing L<sub>s</sub>, dust season and the days with maps
- **Mars calendar:** Mars Year (Clancy et al. 2000), L<sub>s</sub> and Mars Sol Date (Allison & McEwen 2000 / Mars24) — `web/js/marsdate.js`
- **Basemaps:** Viking MDIM 2.1 color and MOLA color shaded relief (NASA Mars Trek WMTS)
- **Overlays:** landing sites, region names, lat/lon grid; −180…180 or 0…360 longitude readout
- **Click details:** coordinates, nearest region and lander (great-circle km, R = 3396.19 km), Mars date
- **Shareable URLs:** date, view and basemap are kept in the URL hash

Run locally:

```bash
cd web && python3 -m http.server 8000   # http://localhost:8000
```

Keys: `←`/`→` step a day, `space` play/pause, `1`/`2` switch tabs.

## Adding daily maps (`tools/prepare_mdgm.py`)

Phase 1 uses Wang et al.'s MDGM v2 color JPEGs from Harvard Dataverse ([doi:10.7910/DVN/U3766S](https://doi.org/10.7910/DVN/U3766S)).

```bash
pip install pillow
# dry run first: check that dates are parsed from the file names
python3 tools/prepare_mdgm.py ~/Downloads/U3766S/ --dry-run
# ingest one week for the MVP
python3 tools/prepare_mdgm.py ~/Downloads/U3766S/ --start 2018-06-01 --limit 7
```

The script reads JPEGs from folders, `.zip` or `.tar` files. It gets dates from file names (`YYYY-MM-DD`, `YYYYMMDD`, `YYYY_DDD`), from `--pattern` or from `--dates-csv`. It writes `web/data/mdgm/YYYY-MM-DD.jpg` and merges the entries into the manifest, including MY and L<sub>s</sub>. Use `--roll180` if a map runs 0…360°E.

> Size budget: one 3600×1800 JPEG is roughly 0.5–1 MB. GitHub Pages is fine for weeks to a few months of maps. A full Mars year or more should move to object storage or tiles (Phase 2).

## Roadmap

1. **MVP:** one week of Wang MDGMs on the timeline ← *now*
2. Polar stereographic views (north/south) for polar hood and cap-edge storms
3. Full-resolution MDGMs from MARCI EDRs with ISIS: `marci2isis → spiceinit → marcical → photomet (Hapke) → cam2map → automos`, with fixes for the opposition effect, saturated pixels and the flat field
4. Cloud-optimized GeoTIFF / XYZ tiles with the date in the tile path, plus a tile server
5. Layers for the Mars Dust Activity Database and dust storm sequences (Wang et al.)

## Data credits

- MARCI MDGMs v2: H. Wang, M. Battalio, Z. Huber (Smithsonian Astrophysical Observatory); MARCI by Malin Space Science Systems / NASA-JPL
- Viking MDIM 2.1: USGS Astrogeology / NASA Ames. MOLA: MGS MOLA Science Team. Tiles: NASA Mars Trek
