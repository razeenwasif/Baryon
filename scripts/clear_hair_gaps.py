#!/usr/bin/env python3
"""Cut out the white pockets left between Fairy's hair locks.

extract_sprites.py only clears white that connects to the sheet's outer edge, so
pockets enclosed by hair stay opaque and show as white patches on the desktop.
A pale patch is cleared when hair surrounds it. Only the long hair below her face
is touched: bangs highlights, the feather locks beside her face, the sheer skirt,
sandals and eyes are pale too but are paint, not gaps.

Run after extract_sprites.py. Idempotent. Needs numpy, pillow and scipy.
"""
import os
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ASSETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets')
POSES = ['sprite', 'dancing', 'waving', 'thinking', 'speaking']

HAIR_Y_MIN, HAIR_Y_MAX = 500, 900  # long hair only, in 840x1520 sprite pixels
TORSO_X = (335, 530)               # bikini and belt highlights also sit inside blue trim; skip the torso column
HAIR_RING = 0.7                   # share of a pocket's surround that must be hair
MIN_PIXELS = 8
FRINGE = 2                         # also drop the pale anti-aliased rim around a pocket


def clear_gaps(path):
    im = np.array(Image.open(path).convert('RGBA')).astype(int)
    r, g, b, a = (im[..., i] for i in range(4))
    opaque = a > 0
    hi, lo = np.maximum(np.maximum(r, g), b), np.minimum(np.minimum(r, g), b)
    chroma = hi - lo

    pale = opaque & (lo >= 222) & (chroma <= 28)
    hair = opaque & ~pale & (b > r + 18) & (b >= g) & (chroma >= 28)

    labels, count = ndi.label(pale, structure=np.ones((3, 3)))
    remove = np.zeros_like(opaque)
    for i in range(1, count + 1):
        mask = labels == i
        if mask.sum() < MIN_PIXELS:
            continue
        ys, xs = np.where(mask)
        if ys.min() < HAIR_Y_MIN or ys.max() >= HAIR_Y_MAX:
            continue
        if TORSO_X[0] <= xs.mean() <= TORSO_X[1]:
            continue
        ring = ndi.binary_dilation(mask, iterations=4) & ~mask
        if hair[ring].mean() >= HAIR_RING:
            remove |= mask

    rim = ndi.binary_dilation(remove, iterations=FRINGE) & opaque & ~remove
    remove |= rim & (lo >= 205) & (chroma <= 40)

    im[remove, 3] = 0
    Image.fromarray(im.astype(np.uint8)).save(path)
    return int(remove.sum())


if __name__ == '__main__':
    for pose in POSES:
        path = os.path.join(ASSETS, f'fairy-{pose}.png')
        print(f'{pose}: cleared {clear_gaps(path)} px')
