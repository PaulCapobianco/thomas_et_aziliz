#!/usr/bin/env python3
"""Estime le stockage ET le trafic sortant (egress) pour le mariage, à partir de VRAIES photos.

Usage : python3 scripts/estimate_storage.py <dossier_de_photos> [--guests 130] [--views 6] [--lightbox 25]
Dépendances : Pillow.

Reproduit la compression de l'application (uploads.js) : full = 3000 px max, JPEG q0.90 ; thumb = 800 px max, JPEG q0.75.
Pillow n'est pas le moteur du navigateur : l'écart de poids est de quelques %, mesurez avec scripts/measure-quality.mjs pour les chiffres du navigateur.
IMPORTANT : donnez-lui 20 à 50 VRAIES photos de téléphone (pas les photos synthétiques de make_test_images.py,
dont le poids ne reflète pas la réalité).

Hypothèses de trafic (modifiables en ligne de commande), par invité sur la durée de l'événement :
  --views     nombre de chargements de la galerie (48 miniatures chacun)       défaut 6
  --lightbox  nombre de photos ouvertes en grand (full)                        défaut 25
  --downloads nombre de photos téléchargées (full)                             défaut 10
Limites des offres : à VÉRIFIER sur la page officielle des tarifs Supabase avant de décider
(valeurs relevées dans un article de juillet 2026 : gratuit 1 Go stockage / 5 Go egress, Pro 100 Go / 250 Go).
"""
import argparse
import io
import sys
from pathlib import Path

from PIL import Image, ImageOps

ap = argparse.ArgumentParser()
ap.add_argument("folder", nargs="?", help="dossier de vraies photos (facultatif si --assume-full-kb est donné)")
ap.add_argument("--assume-full-kb", type=float, help="sans photos : poids moyen supposé d'un full 2560 px (typiquement 500 à 1400)")
ap.add_argument("--assume-thumb-kb", type=float, default=70, help="poids moyen supposé d'une miniature 800 px (défaut 70)")
ap.add_argument("--guests", type=int, default=130)
ap.add_argument("--views", type=int, default=6)
ap.add_argument("--lightbox", type=int, default=25)
ap.add_argument("--downloads", type=int, default=10)
a = ap.parse_args()

PLANS = {"Gratuit": (1.0, 5.0), "Pro": (100.0, 250.0)}   # (Go de stockage, Go d'egress)
exts = {".jpg", ".jpeg", ".png", ".webp", ".heic"}


def encode(img, side, q):
    im = img.copy()
    im.thumbnail((side, side))   # ne grossit jamais une image plus petite que side
    buf = io.BytesIO()
    im.convert("RGB").save(buf, "JPEG", quality=q)
    return buf.tell()


if a.assume_full_kb:
    avg_full, avg_thumb = a.assume_full_kb * 1024, a.assume_thumb_kb * 1024
    print(f"HYPOTHÈSE (non mesurée) : full = {a.assume_full_kb:.0f} Ko, thumb = {a.assume_thumb_kb:.0f} Ko. Remplacez par une mesure sur de vraies photos.")
else:
    if not a.folder:
        sys.exit("Donnez un dossier de photos ou --assume-full-kb.")
    files = [p for p in sorted(Path(a.folder).iterdir()) if p.suffix.lower() in exts]
    if not files:
        sys.exit("Aucune image trouvée.")
    fulls, thumbs, skipped = [], [], 0
    for p in files:
        try:
            img = ImageOps.exif_transpose(Image.open(p))
            fulls.append(encode(img, 3000, 90))
            thumbs.append(encode(img, 800, 75))
        except Exception:
            skipped += 1
    if not fulls:
        sys.exit("Aucune image décodable : estimation impossible.")
    avg_full, avg_thumb = sum(fulls) / len(fulls), sum(thumbs) / len(thumbs)
    print(f"{len(fulls)} photos mesurées ({skipped} ignorées).  full moyen = {avg_full/1024:.0f} Ko   thumb moyen = {avg_thumb/1024:.0f} Ko")
    if len(fulls) < 20:
        print("ATTENTION : moins de 20 photos => estimation peu fiable.")

per_guest_egress = (a.views * 48 * avg_thumb + (a.lightbox + a.downloads) * avg_full)
egress_gb = a.guests * per_guest_egress / 1e9
print(f"\nTrafic sortant estimé ({a.guests} invités, {a.views} chargements de galerie, {a.lightbox} ouvertures, {a.downloads} téléchargements chacun) : {egress_gb:.1f} Go")
print("(En pratique, les gens téléchargent plus dans les jours qui suivent : prévoir x2 sur le trafic.)\n")

print(f"{'Photos':>8} {'/invité':>8} {'Stockage':>10}   " + "   ".join(f"{n:>18}" for n in PLANS))
for n in (1300, 3000, 5000, 10000):
    per_guest = round(n / a.guests)
    gb = n * (avg_full + avg_thumb) / 1e9
    cells = []
    for name, (sto, egr) in PLANS.items():
        ok = gb <= sto and egress_gb * 2 <= egr
        cells.append(f"{'OK' if ok else 'DÉPASSE':>18}")
    print(f"{n:>8} {per_guest:>8} {gb:>8.2f} Go   " + "   ".join(cells))
print("\nComparaison conservatrice : stockage <= quota ET trafic entièrement non caché x2 <= quota. Les quotas de trafic caché sont distincts.")
print("Vérifier les quotas et conditions actuels dans Supabase avant le 25 octobre ; la saturation peut empêcher les envois. Le polling augmente les chargements de galerie.")
