#!/usr/bin/env python3
"""Scores the files written by measure-quality.mjs against a Lanczos reference made from the same source.
PSNR (dB, higher = closer) against a Lanczos resize of the SOURCE to the same size; the legacy image is first enlarged to that size,
as a screen would show it. It cannot recover detail lost earlier: it only compares two pipelines on the same source.
Usage: python3 scripts/quality_report.py OUT_DIR photo1.jpg photo2.jpg ..."""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageOps

out = Path(sys.argv[1]); sources = [Path(p) for p in sys.argv[2:]]
def psnr(a, b):
    a = np.asarray(a.convert("RGB"), dtype=np.float64); b = np.asarray(b.convert("RGB"), dtype=np.float64)
    mse = ((a - b) ** 2).mean(); return 99.0 if mse == 0 else 10 * np.log10(255 ** 2 / mse)
print(f"{'photo':30} {'kind':6} {'legacy dB':>10} {'new dB':>8}")
import re
for src in sources:
    key = re.sub(r"\W+", "_", src.stem)
    im = ImageOps.exif_transpose(Image.open(src)).convert("RGB")
    for kind in ("Full", "Thumb"):
        old = Image.open(out / f"{key}.legacy{kind}.jpg"); new = Image.open(out / f"{key}.new{kind}.jpg")
        ref = im.resize(new.size, Image.LANCZOS) if max(im.size) > max(new.size) else im
        print(f"{src.stem[:30]:30} {kind:6} {psnr(old.resize(new.size, Image.BICUBIC), ref):10.2f} {psnr(new, ref):8.2f}")
