#!/usr/bin/env python3
"""Ingest Wang et al. MARCI MDGM v2 color JPEGs into the web viewer.

Reads JPEGs from directories, .tar/.tar.gz, or .zip archives, works out each
map's UTC date, optionally re-centres it to -180..180 and resizes, writes
web/data/mdgm/YYYY-MM-DD.jpg, and merges entries into web/data/manifest.json
with Mars Year and Ls.

Dates come from the file name (YYYY-MM-DD, YYYYMMDD, or YYYY_DDD / YYYYDDD
day-of-year), or from a CSV (--dates-csv) with columns: filename,date.
If neither works for your files, pass --pattern with a regex that has named
groups (year, month, day) or (year, doy).

Examples
  python tools/prepare_mdgm.py ~/Downloads/U3766S/*.zip --limit 7
  python tools/prepare_mdgm.py mdgms/ --roll180 --max-width 3600
  python tools/prepare_mdgm.py mdgms/ --pattern 'MDGM_(?P<year>\\d{4})_(?P<doy>\\d{3})'
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import math
import re
import sys
import tarfile
import zipfile
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Iterator

from PIL import Image

Image.MAX_IMAGE_PIXELS = None  # 0.05 deg maps are 7200x3600

ROOT = Path(__file__).resolve().parents[1]
WEB_DATA = ROOT / "web" / "data"

# ---------------------------------------------------------------- Mars date
# Allison & McEwen (2000) / Mars24. Mirrors web/js/marsdate.js.
_PBS = [
    (0.0071, 2.2353, 49.409), (0.0057, 2.7543, 168.173), (0.0039, 1.1177, 191.837),
    (0.0037, 15.7866, 21.736), (0.0021, 2.1354, 15.704), (0.0020, 2.4694, 95.528),
    (0.0018, 32.8493, 49.095),
]
_TT_UTC = 69.184
_MY1_JD = 2435208.5
_MY_DAYS = 686.9726


def _jd_tt(dt: datetime) -> float:
    return dt.timestamp() / 86400 + 2440587.5 + _TT_UTC / 86400


def solar_longitude(dt: datetime) -> float:
    d = _jd_tt(dt) - 2451545.0
    m = math.radians(19.3871 + 0.52402073 * d)
    a_fms = 270.3871 + 0.524038496 * d
    pbs = sum(a * math.cos(math.radians(0.985626 * d / tau + phi)) for a, tau, phi in _PBS)
    eoc = ((10.691 + 3.0e-7 * d) * math.sin(m) + 0.623 * math.sin(2 * m)
           + 0.050 * math.sin(3 * m) + 0.005 * math.sin(4 * m) + 0.0005 * math.sin(5 * m) + pbs)
    return (a_fms + eoc) % 360


def mars_year(dt: datetime) -> int:
    ls = solar_longitude(dt)
    years = (_jd_tt(dt) - _MY1_JD) / _MY_DAYS
    my = math.floor(years) + 1
    frac = years - math.floor(years)
    if frac < 0.1 and ls > 300:
        my -= 1
    elif frac > 0.9 and ls < 60:
        my += 1
    return my


# ---------------------------------------------------------------- inputs
JPEG_RE = re.compile(r"\.(jpe?g|png|tiff?)$", re.I)  # image inputs
MARCI_ID = re.compile(r"(?P<sp>[A-Z]\d{2})_(?P<orbit>\d{6})_(?P<ls>\d{4})_")
DATE_PATTERNS = [
    re.compile(r"(?P<year>(?:19|20)\d{2})[-_](?P<month>\d{2})[-_](?P<day>\d{2})"),
    re.compile(r"(?<!\d)(?P<year>(?:19|20)\d{2})(?P<month>[01]\d)(?P<day>[0-3]\d)(?!\d)"),
    re.compile(r"(?<!\d)(?P<year>(?:19|20)\d{2})[-_]?(?P<doy>[0-3]\d{2})(?!\d)"),
]


@dataclass
class Item:
    name: str      # base file name
    origin: str    # where it came from (for provenance)
    data: bytes


def iter_inputs(paths: list[Path]) -> Iterator[Item]:
    for p in paths:
        if p.is_dir():
            for f in sorted(p.rglob("*")):
                if f.is_file():
                    yield from iter_inputs([f])
        elif JPEG_RE.search(p.name):
            yield Item(p.name, str(p), p.read_bytes())
        elif zipfile.is_zipfile(p):
            with zipfile.ZipFile(p) as z:
                for n in sorted(z.namelist()):
                    if JPEG_RE.search(n):
                        yield Item(Path(n).name, f"{p.name}:{n}", z.read(n))
        elif tarfile.is_tarfile(p):
            with tarfile.open(p) as t:
                for m in t:
                    if m.isfile() and JPEG_RE.search(m.name):
                        yield Item(Path(m.name).name, f"{p.name}:{m.name}", t.extractfile(m).read())


def date_from_name(name: str, patterns: list[re.Pattern]) -> date | None:
    for pat in patterns:
        m = pat.search(name)
        if not m:
            continue
        g = m.groupdict()
        try:
            if g.get("doy"):
                return date(int(g["year"]), 1, 1) + timedelta(days=int(g["doy"]) - 1)
            return date(int(g["year"]), int(g["month"]), int(g["day"]))
        except ValueError:
            continue
    return None


def geo_box(w: int, h: int) -> tuple[float, float, float, float]:
    """Pixel box in the source image covering exactly 180W-180E, 90N-90S.

    Wang grids come as N x N/2 (pixel-edge registered) or N x (N/2 + 1)
    (row centers at 90N ... 90S, so the first/last rows are half outside).
    """
    if h == w // 2 + 1:
        return (0.0, 0.5, float(w), h - 0.5)
    return (0.0, 0.0, float(w), float(h))


def write_tiles(img: Image.Image, out_dir: Path, max_zoom: int, quality: int) -> int:
    """Cut an equirectangular global map into a 256 px EPSG:4326 pyramid.

    Same grid as NASA Mars Trek EQ tiles: zoom 0 is 2 x 1 tiles of 180 deg,
    tile path {z}/{row}/{col}. No-data (black) becomes transparent; tiles
    are lossy WebP with alpha. Returns the number of tiles written.
    """
    rgb = img.convert("RGB")
    box = geo_box(*rgb.size)
    # mask: pure/near black = no data
    lum = rgb.convert("L")
    alpha = lum.point(lambda v: 0 if v <= 6 else 255)
    rgba = rgb.copy()
    rgba.putalpha(alpha)
    n = 0
    for z in range(max_zoom + 1):
        cols, rows = 2 ** (z + 1), 2 ** z
        level = rgba.resize((cols * 256, rows * 256), Image.LANCZOS, box=box)
        for r in range(rows):
            for c in range(cols):
                tile = level.crop((c * 256, r * 256, (c + 1) * 256, (r + 1) * 256))
                if tile.getchannel("A").getextrema() == (0, 0):
                    continue  # fully empty, the viewer shows nothing anyway
                p = out_dir / str(z) / str(r) / f"{c}.webp"
                p.parent.mkdir(parents=True, exist_ok=True)
                tile.save(p, "WEBP", quality=quality, method=6)
                n += 1
    return n


def native_zoom(width: int) -> int:
    """Smallest zoom whose resolution is at least as fine as the source."""
    z = 0
    while 512 * 2 ** z < width:
        z += 1
    return z


def subphase_from_name(name: str) -> str | None:
    # MRO mission subphase codes look like P01, B12, G05, J03 ...
    m = re.search(r"(?<![A-Za-z0-9])([A-Z]\d{2})(?![0-9])", name)
    return m.group(1) if m else None


# ---------------------------------------------------------------- main
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("inputs", nargs="+", type=Path, help="JPEG files, directories, .zip or .tar archives")
    ap.add_argument("--out", type=Path, default=WEB_DATA, help="web data directory (default: web/data)")
    ap.add_argument("--dates-csv", type=Path, help="CSV with columns filename,date (YYYY-MM-DD)")
    ap.add_argument("--date", help="date for a single input file (YYYY-MM-DD)")
    ap.add_argument("--subphase", help="MRO subphase label, e.g. B01")
    ap.add_argument("--day", type=int, help="day number within the subphase")
    ap.add_argument("--format", choices=["tiles", "jpeg", "both"], default="tiles",
                    help="tiles: WebP XYZ pyramid (default); jpeg: one global JPEG")
    ap.add_argument("--pattern", action="append", default=[], help="extra filename regex with named groups")
    ap.add_argument("--roll180", action="store_true", help="input spans 0..360E; shift so it spans -180..180")
    ap.add_argument("--max-width", type=int, default=3600, help="downsample if wider (default 3600 = 0.1 deg)")
    ap.add_argument("--quality", type=int, default=82)
    ap.add_argument("--start", help="only dates on/after YYYY-MM-DD")
    ap.add_argument("--end", help="only dates on/before YYYY-MM-DD")
    ap.add_argument("--limit", type=int, help="stop after N maps (e.g. 7 for an MVP week)")
    ap.add_argument("--dry-run", action="store_true", help="report what would be written")
    args = ap.parse_args()

    patterns = [re.compile(p) for p in args.pattern] + DATE_PATTERNS
    csv_dates: dict[str, str] = {}
    if args.dates_csv:
        with args.dates_csv.open() as fh:
            for row in csv.DictReader(fh):
                csv_dates[Path(row["filename"]).name] = row["date"]

    start = date.fromisoformat(args.start) if args.start else None
    end = date.fromisoformat(args.end) if args.end else None

    out_img = args.out / "mdgm"
    manifest_path = args.out / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {"version": 1, "days": []}
    by_date = {d["date"]: d for d in manifest.get("days", [])}

    written = skipped = 0
    for item in iter_inputs(args.inputs):
        if args.date:
            d = date.fromisoformat(args.date)
        elif item.name in csv_dates:
            d = date.fromisoformat(csv_dates[item.name])
        else:
            d = date_from_name(item.name, patterns)
        if d is None:
            print(f"  ? no date in {item.origin} — add --pattern or --dates-csv", file=sys.stderr)
            skipped += 1
            continue
        if (start and d < start) or (end and d > end):
            continue

        img = Image.open(io.BytesIO(item.data)).convert("RGB")
        w, h = img.size
        if abs(w / h - 2) > 0.01 and h != w // 2 + 1:
            print(f"  ! {item.origin}: {w}x{h} is not 2:1 — is this a global map? skipping", file=sys.stderr)
            skipped += 1
            continue
        if args.roll180:
            left, right = img.crop((0, 0, w // 2, h)), img.crop((w // 2, 0, w, h))
            img = Image.new("RGB", (w, h))
            img.paste(right, (0, 0))
            img.paste(left, (w // 2, 0))
        noon = datetime(d.year, d.month, d.day, 12, tzinfo=timezone.utc)
        iso = d.isoformat()
        entry = {
            "date": iso,
            "my": mars_year(noon),
            "ls": round(solar_longitude(noon), 2),
            "width": img.size[0],
            "height": img.size[1],
            "source_file": item.name,
        }
        sp = args.subphase or subphase_from_name(item.origin)
        if sp:
            entry["subphase"] = sp
        if args.day:
            entry["day"] = args.day
        mid = MARCI_ID.search(item.name)
        if mid:  # PPP_NNNNNN_TTTT_...: subphase, orbit, Ls at image start (0.1 deg)
            entry.setdefault("subphase", mid["sp"])
            entry["orbit"] = int(mid["orbit"])
            entry["ls_start"] = int(mid["ls"]) / 10
        zmax = native_zoom(img.size[0])
        if args.format in ("tiles", "both"):
            entry["tiles"] = f"data/mdgm/tiles/{iso}/{{z}}/{{y}}/{{x}}.webp"
            entry["maxZoom"] = zmax
        if args.format in ("jpeg", "both"):
            entry["url"] = f"data/mdgm/{iso}.jpg"

        if args.dry_run:
            print(f"  would write {iso}  MY {entry['my']} Ls {entry['ls']:6.2f}  <- {item.origin}")
        else:
            out_img.mkdir(parents=True, exist_ok=True)
            if "tiles" in entry:
                n = write_tiles(img, out_img / "tiles" / iso, zmax, args.quality)
                print(f"  tiled {iso} z0-{zmax}: {n} tiles  MY {entry['my']} Ls {entry['ls']:6.2f}")
            if "url" in entry:
                j = img.crop(tuple(round(v) for v in geo_box(*img.size)))
                if j.size[0] > args.max_width:
                    j = j.resize((args.max_width, args.max_width // 2), Image.LANCZOS)
                j.convert("RGB").save(out_img / f"{iso}.jpg", "JPEG", quality=args.quality, optimize=True, progressive=True)
                print(f"  wrote {entry['url']}")
        by_date[entry["date"]] = entry
        written += 1
        if args.limit and written >= args.limit:
            break

    if not args.dry_run:
        manifest["days"] = sorted(by_date.values(), key=lambda e: e["date"])
        manifest_path.write_text(json.dumps(manifest, indent=1) + "\n")
    print(f"{written} maps {'found' if args.dry_run else 'written'}, {skipped} skipped, "
          f"{len(by_date)} in manifest")
    return 0


if __name__ == "__main__":
    sys.exit(main())
