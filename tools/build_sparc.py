"""Build gravity/sparc-data.json from the SPARC rotation-curve files.

Usage (standard library only):
    python3 tools/build_sparc.py [path/to/Rotmod_LTG.zip] [path/to/SPARC_Lelli2016c.mrt]

Defaults point at a sibling checkout of dark-matter-research. Every galaxy in the
archive is kept (175). Rows are dropped only when the radius, observed speed or
its uncertainty is not positive and finite, the same row filter used by the
dark-matter-research analysis. Values keep the precision of the source files
(radii and speeds to 0.01), so fits reproduce the research numbers exactly.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA = ROOT.parent / "dark-matter-research" / "data"
OUT = ROOT / "gravity" / "sparc-data.json"


def num(text: str) -> float:
    return float(text)


def compact(x: float, digits: int = 2) -> float | int:
    v = round(x, digits)
    return int(v) if v == int(v) else v


def sig(x: float, n: int = 3) -> float | int:
    if x == 0:
        return 0
    d = n - 1 - int(math.floor(math.log10(abs(x))))
    return compact(round(x, d), max(d, 0))


def read_table(path: Path) -> dict:
    meta = {}
    for line in path.read_text().splitlines():
        f = line.split()
        if len(f) < 18:
            continue
        try:
            q = int(f[17])
            meta[f[0]] = {
                "T": int(f[1]), "D": num(f[2]), "inc": num(f[5]), "L36": num(f[7]),
                "Rdisk": num(f[11]), "MHI": num(f[13]), "Vflat": num(f[15]), "Q": q,
            }
        except ValueError:
            continue
    return meta


def read_curve(text: str) -> dict:
    cols = {k: [] for k in ("R", "Vobs", "eV", "Vgas", "Vdisk", "Vbul")}
    dropped = 0
    for line in text.splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        v = [float(x) for x in line.split()[:6]]
        if not all(math.isfinite(x) for x in v) or v[0] <= 0 or v[1] <= 0 or v[2] <= 0:
            dropped += 1
            continue
        for k, x in zip(cols, v):
            cols[k].append(compact(x))
    return cols, dropped


def main() -> None:
    zpath = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_DATA / "Rotmod_LTG.zip"
    mpath = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_DATA / "SPARC_Lelli2016c.mrt"
    meta = read_table(mpath)
    galaxies, dropped = [], 0
    with ZipFile(zpath) as z:
        for name in sorted(z.namelist()):
            key = name.replace("_rotmod.dat", "")
            curve, d = read_curve(z.read(name).decode())
            dropped += d
            m = meta[key]
            galaxies.append({
                "name": key, "T": m["T"], "D": sig(m["D"]), "inc": sig(m["inc"]), "L36": sig(m["L36"]),
                "Rdisk": sig(m["Rdisk"]), "MHI": sig(m["MHI"]), "Vflat": sig(m["Vflat"]), "Q": m["Q"], **curve,
            })
    payload = {
        "source": "SPARC, Lelli, McGaugh & Schombert 2016, AJ 152, 157",
        "note": ("Rotation curves (R kpc; Vobs, eV, Vgas, Vdisk, Vbul km/s; disk and bulge at M/L = 1) and galaxy table "
                 "(T Hubble type 0=S0..11=BCD; D Mpc; inc deg; L36 1e9 Lsun at 3.6 um; Rdisk kpc; MHI 1e9 Msun; "
                 "Vflat km/s, 0 if undefined; Q 1 high .. 3 low). "
                 f"{len(galaxies)} galaxies; {dropped} rows with non-positive radius, speed or error removed."),
        "galaxies": galaxies,
    }
    OUT.write_text(json.dumps(payload, separators=(",", ":")) + "\n")
    print(f"wrote {OUT} ({OUT.stat().st_size / 1024:.0f} KB, {len(galaxies)} galaxies, {dropped} rows dropped)")


if __name__ == "__main__":
    main()
