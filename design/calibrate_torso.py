"""Measure a usable chest crop on the packaged line art and foreground of each pose."""
import json
from pathlib import Path
import sys

import numpy as np
from PIL import Image


def crop_band(web, pose):
    size = 256
    mid = sum(p[0] for p in pose['eyes']) / 2
    paths = [web/'sketches'/(pose['id']+'.webp'), web/'assets'/(pose['id']+'-guide.png'),
             web/'figures'/(pose['id']+'.webp')]
    arrays = []
    for i, path in enumerate(paths):
        with Image.open(path) as im:
            rgba = np.asarray(im.convert('RGBA').resize((size,size),Image.Resampling.LANCZOS))
        if i==0:
            warm = rgba[:,:,0] > rgba[:,:,2]
            arrays.extend([np.where(warm,rgba[:,:,3],0), np.where(~warm,rgba[:,:,3],0)])
        else:
            arrays.append(rgba[:,:,3])
    warm, cool, comic, figure = arrays
    x = np.arange(size)
    layers = np.stack([warm >= 38, cool >= 38, (comic >= 40) & (x < mid*size),
                       (comic >= 40) & (x >= mid*size), figure > 128])
    # One stroke for each partner and comic half, plus a substantial patch of
    # clothing. All must remain on screen for every row in the valid interval.
    counts = np.pad(layers.cumsum(axis=2), ((0,0),(0,0),(1,0)))
    minimum = np.array([1, 1, 1, 1, 32])[:, None]
    valid = ((counts[:,:,size-2] - counts[:,:,2]) >= minimum).all(axis=0)
    chin = max(y + .68 * radius for _, y, _, radius in pose['heads'])
    valid[:int(max(.63, chin+.015)*size)] = False
    valid[int(.985*size):] = False
    edges = np.flatnonzero(np.diff(np.r_[False, valid, False]))
    start, end = max(zip(edges[::2], edges[1::2]), key=lambda b: b[1]-b[0], default=(0,0))
    if end-start < 6:
        raise ValueError(f"{pose['id']}: no shared torso crop")
    counts = counts[:, start:end, :]
    # The tightest horizontal bounds give users more room to pan the guide.
    best = (size, size)
    right = round(mid*size)
    for left in range(2, round(mid*size)):
        while right < size-2 and np.any(counts[:,:,right]-counts[:,:,left] < minimum):
            right += 1
        if np.any(counts[:,:,right]-counts[:,:,left] < minimum):
            break
        key = (right-left, abs((left+right)/2-mid*size))
        if key < best:
            best = key
            bounds = (max(left-3,0), min(right+3,size))
    return [round(float(v)/size, 4) for v in (*bounds, start+1, end-1)]


if __name__ == '__main__':
    web = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / 'web'
    path = web / 'library.json'
    poses = json.loads(path.read_text(encoding='utf-8'))
    for pose in poses:
        pose['torsoCrop'] = crop_band(web, pose)
    path.write_text(json.dumps(poses, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'Measured {len(poses)} torso crops.')
