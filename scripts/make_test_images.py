#!/usr/bin/env python3
"""Génère un jeu de photos de test dans ./fixtures (à ne pas commiter) + manifest.json.

Usage : python3 scripts/make_test_images.py [dossier_sortie] [--stress]
Dépendances : Pillow, numpy.

Les images sont SYNTHÉTIQUES (dégradés + bruit pour avoir un poids réaliste de photo de téléphone).
Elles servent à tester : doublons exacts, photos similaires, orientation EXIF, PNG, fichiers invalides.
Elles ne remplacent pas un test avec de VRAIES photos de téléphone (voir scripts/estimate_storage.py).
Aucune image NSFW n'est générée : la classification NSFWJS se teste avec un mock injecté (voir DECISIONS_PREPAREES.md, D08).
"""
import json
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

out = Path(next((a for a in sys.argv[1:] if not a.startswith("--")), "fixtures"))
stress = "--stress" in sys.argv
out.mkdir(parents=True, exist_ok=True)
rng = np.random.default_rng(31102026)


def scene(w, h, seed, brightness=0):
    """Image 'photo' : dégradé de ciel, horizon, formes, + bruit pour un JPEG de poids réaliste."""
    r = np.random.default_rng(seed)
    y = np.linspace(0, 1, h, dtype=np.float32)[:, None]
    x = np.linspace(0, 1, w, dtype=np.float32)[None, :]
    base = np.stack([
        180 + 60 * y + 20 * np.sin(6 * x + seed),
        130 + 80 * (1 - y) + 15 * np.cos(5 * x),
        100 + 100 * (1 - y) * x + 30 * np.sin(3 * y + seed),
    ], axis=-1)
    noise = r.normal(0, 9, size=(h, w, 1)).astype(np.float32)
    arr = np.clip(base + noise + brightness, 0, 255).astype(np.uint8)
    img = Image.fromarray(arr, "RGB")
    d = ImageDraw.Draw(img)
    for _ in range(6):
        cx, cy = int(r.integers(0, w)), int(r.integers(0, h))
        rad = int(r.integers(min(w, h) // 20, min(w, h) // 6))
        col = tuple(int(c) for c in r.integers(40, 230, 3))
        d.ellipse((cx - rad, cy - rad, cx + rad, cy + rad), fill=col)
    return img


manifest = {}


def save_jpg(name, img, q=92, exif=None, note=""):
    p = out / name
    kw = {"quality": q}
    if exif is not None:
        kw["exif"] = exif
    img.save(p, "JPEG", **kw)
    manifest[name] = {"bytes": p.stat().st_size, "size": list(img.size), "note": note}


# 3 photos distinctes (format téléphone 12 Mpx)
for i in (1, 2, 3):
    save_jpg(f"photo_{i:02d}.jpg", scene(4032, 3024, seed=i), note="photo distincte")

# Doublon STRICT : copie octet par octet (même SHA-256) => doit être ignoré dans la même destination
shutil.copy(out / "photo_01.jpg", out / "photo_01_copie_exacte.jpg")
manifest["photo_01_copie_exacte.jpg"] = {"bytes": (out / "photo_01.jpg").stat().st_size, "note": "doublon exact de photo_01.jpg"}

# Photos SIMILAIRES mais différentes (rafale) => toutes conservées
save_jpg("rafale_a.jpg", scene(4032, 3024, seed=7), note="rafale : similaire à rafale_b (SHA différent)")
save_jpg("rafale_b.jpg", scene(4032, 3024, seed=7, brightness=6), note="rafale : similaire à rafale_a (SHA différent)")

# Orientation EXIF 6 (rotation 90°) : le rendu final doit être PORTRAIT
exif = Image.Exif()
exif[0x0112] = 6
save_jpg("portrait_exif6.jpg", scene(4032, 3024, seed=11), exif=exif, note="pixels paysage + EXIF orientation 6 => doit s'afficher en portrait")

# Autres formats / cas d'erreur
scene(3000, 2000, seed=21).save(out / "photo_png.png")
manifest["photo_png.png"] = {"bytes": (out / "photo_png.png").stat().st_size, "note": "PNG valide"}
Image.new("RGB", (1, 1), (255, 0, 0)).save(out / "minuscule_1x1.png")
manifest["minuscule_1x1.png"] = {"note": "image 1x1 : ne doit pas planter"}
data = (out / "photo_02.jpg").read_bytes()
(out / "corrompue.jpg").write_bytes(data[: len(data) // 3])
manifest["corrompue.jpg"] = {"note": "JPEG tronqué : erreur de décodage explicite, les autres fichiers du lot continuent"}
(out / "pas_une_image.jpg").write_text("ceci n'est pas une image", encoding="utf-8")
manifest["pas_une_image.jpg"] = {"note": "texte renommé en .jpg : refusé proprement"}

if stress:
    save_jpg("stress_48mpx.jpg", scene(8000, 6000, seed=99), q=90, note="48 Mpx : test mémoire iPhone/Android")

(out / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
total = sum(f.stat().st_size for f in out.iterdir() if f.is_file()) / 1e6
print(f"{len(manifest)} fichiers générés dans {out}/ ({total:.0f} Mo). Ne pas commiter ce dossier.")
