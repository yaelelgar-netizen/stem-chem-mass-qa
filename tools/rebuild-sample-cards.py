# -*- coding: utf-8 -*-
"""card-anor / card-vesic / card-mare were exported with a ghost of the lab
scene flattened into the card, which shows badly on this unit's dark plate.
Rebuild them: clean template + their own rock, nothing else.

The template is synthesised rather than lifted wholesale from card-regolith,
because that card's own pile spills outside the sage disc:
  * body  — a pure vertical gradient (verified flat horizontally), so each row
            is filled with the median of that row's pale body pixels;
  * disc  — flat sage, sampled from the clean card above its pile;
  * art   — corner arrows and name band taken back from the clean card.
Only the largest connected blob (the rock and its shadow) is carried over from
each source card, which also drops the loose gravel specks around it.
"""
import os
import numpy as np
from PIL import Image
from scipy import ndimage

IMG = (r"C:\Users\user\OneDrive - methodic.co.il\Documents\STEM\מתמטיקה\צעדים ומונים"
       r"\פיתוח STEM\כימיה 2 (מסה)\הפקה\stem-chem-mass\assets\images")
SRC = (r"C:\Users\user\OneDrive - methodic.co.il\Documents\STEM\מתמטיקה\צעדים ומונים"
       r"\פיתוח STEM\כימיה 1 (נפח)\הפקה\stem-chem-volume\assets\images")

DISC_C, DISC_R = (180, 193), 119
BAND_TOP, DARK = 328, 170


def luma(a):
    return a[..., :3] @ [0.299, 0.587, 0.114]


clean = np.asarray(Image.open(os.path.join(IMG, 'card-regolith.png')).convert('RGBA')).astype(float)
h, w, _ = clean.shape
Y, X = np.mgrid[0:h, 0:w]
d2 = (X - DISC_C[0]) ** 2 + (Y - DISC_C[1]) ** 2
disc = d2 <= DISC_R ** 2
solid = clean[..., 3] > 200
clum = luma(clean)

DISC_RGB = np.median(clean[80:140, 150:210].reshape(-1, 4)[:, :3], axis=0)   # sage, above the pile

# body: one flat colour per row
body = np.zeros((h, 3))
last = np.array([192., 220., 220.])
for y in range(h):
    sel = (~disc[y]) & solid[y] & (clum[y] > 175)
    if sel.sum() >= 30:
        last = np.median(clean[y][sel][:, :3], axis=0)
    body[y] = last

template = clean.copy()
template[..., :3] = np.repeat(body[:, None, :], w, axis=1)
disc_f = ndimage.gaussian_filter(disc.astype(float), 0.7)[..., None]
template[..., :3] = DISC_RGB * disc_f + template[..., :3] * (1 - disc_f)

art = solid & (clum < DARK) & ~disc                       # corner arrows + name band
art_f = ndimage.gaussian_filter(art.astype(float), 0.6)[..., None]
template[..., :3] = clean[..., :3] * art_f + template[..., :3] * (1 - art_f)

for name in ('card-anor.png', 'card-vesic.png', 'card-mare.png'):
    src = np.asarray(Image.open(os.path.join(SRC, name)).convert('RGBA')).astype(float)
    # the rock is what departs strongly from the reconstructed background;
    # the baked ghost only deviates by ~16, the rock by 100+
    off = np.abs(src[..., :3] - template[..., :3]).max(axis=2)
    raw = (off > 45) & (Y < BAND_TOP) & (d2 <= (DISC_R + 70) ** 2) & solid
    raw = ndimage.binary_closing(raw, np.ones((5, 5)))
    raw = ndimage.binary_fill_holes(raw)
    lab, n = ndimage.label(raw)
    if n:
        sizes = ndimage.sum(raw, lab, range(1, n + 1))
        raw = lab == (int(np.argmax(sizes)) + 1)          # the rock blob only
    keep = ndimage.gaussian_filter(raw.astype(float), 0.8)[..., None]

    out = template.copy()
    out[..., :3] = src[..., :3] * keep + template[..., :3] * (1 - keep)
    out[..., 3] = clean[..., 3]
    Image.fromarray(out.clip(0, 255).astype(np.uint8)).save(os.path.join(IMG, name))
    print('%-18s rock blob %6d px' % (name, int(raw.sum())))

print('disc %s   body top %s  bottom %s'
      % (tuple(DISC_RGB.round().astype(int)), tuple(body[30].round().astype(int)),
         tuple(body[470].round().astype(int))))
