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
JPEG_RE = re.compile(r"\.jpe?g$", re.I)
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
    ap.add_argument("--pattern", action="append", default=[], help="extra filename regex with named groups")
    ap.add_argument("--roll180", action="store_true", help="input spans 0..360E; shift so it spans -180..180")
    ap.add_argument("--max-width", type=int, default=3600, help="downsample if wider (default 3600 = 0.1 deg)")
    ap.add_argument("--quality", type=int, default=85)
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
        d = date.fromisoformat(csv_dates[item.name]) if item.name in csv_dates else date_from_name(item.name, patterns)
        if d is None:
            print(f"  ? no date in {item.origin} — add --pattern or --dates-csv", file=sys.stderr)
            skipped += 1
            continue
        if (start and d < start) or (end and d > end):
            continue

        img = Image.open(io.BytesIO(item.data)).convert("RGB")
        w, h = img.size
        if abs(w / h - 2) > 0.01:
            print(f"  ! {item.origin}: {w}x{h} is not 2:1 — is this a global map? skipping", file=sys.stderr)
            skipped += 1
            continue
        if args.roll180:
            left, right = img.crop((0, 0, w // 2, h)), img.crop((w // 2, 0, w, h))
            img = Image.new("RGB", (w, h))
            img.paste(right, (0, 0))
            img.paste(left, (w // 2, 0))
        if w > args.max_width:
            img = img.resize((args.max_width, args.max_width // 2), Image.LANCZOS)

        noon = datetime(d.year, d.month, d.day, 12, tzinfo=timezone.utc)
        rel = f"data/mdgm/{d.isoformat()}.jpg"
        entry = {
            "date": d.isoformat(),
            "url": rel,
            "my": mars_year(noon),
            "ls": round(solar_longitude(noon), 2),
            "width": img.size[0],
            "height": img.size[1],
            "source_file": item.name,
        }
        sp = subphase_from_name(item.origin)
        if sp:
            entry["subphase"] = sp

        if args.dry_run:
            print(f"  would write {rel}  MY {entry['my']} Ls {entry['ls']:6.2f}  <- {item.origin}")
        else:
            out_img.mkdir(parents=True, exist_ok=True)
            img.save(out_img / f"{d.isoformat()}.jpg", "JPEG", quality=args.quality, optimize=True, progressive=True)
            print(f"  wrote {rel}  MY {entry['my']} Ls {entry['ls']:6.2f}")
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
