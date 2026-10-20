"""Makes the 3D region map's terrain (region-map.html) from Benjakronk's painted map of the Shiman Federation
(assets/Shiman Federation.png). Shima is invented, so there's no real elevation data: the heights are read from the
painting instead -- the sea is the blue around the island, the mountains the grey / brown / snowy areas he painted,
the forests and the plains the greens -- plus some fractal noise so the peaks are rough instead of smooth bumps.

Writes into assets/region-map/:
  height.png    the height map: R = high byte, G = low byte of the height in metres (+ SEA_OFFSET, so the sea floor
                fits), B = what's there (0 sea, 1 land, 2 lake, 3 river). The same size as the painting.
  topo.jpg      the topographic map picture (2x): colours by height, the mountains shaded, the sea coloured by depth,
                the lake, the rivers and the roads traced from the painting.
  painted.jpg   the painting itself (2x), with a little of the same shading so it reads as 3D.
  places.json   what the viewer marks: the towns (TOWNS below), the red dots found in the painting, and the names
                written on the water -- positions in painting pixels.

Not run on the Pi: run it on a PC after the painting (or a hand-painted height map, see HAND_HEIGHT below) changes,
and commit what it writes. Needs numpy, scipy and pillow:
  python -m venv .venv && .venv/Scripts/pip install numpy scipy pillow
  .venv/Scripts/python tools/region-map/make_terrain.py
"""
import json
import os

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SOURCE = os.path.join(ROOT, 'assets', 'Shiman Federation.png')
OUT = os.path.join(ROOT, 'assets', 'region-map')
# A greyscale picture the size of the painting (black = sea level, white = HAND_MAX metres) that, when it exists,
# replaces the heights read from the painting -- for when Benjakronk wants to shape the land himself.
HAND_HEIGHT = os.path.join(OUT, 'height-hand.png')
HAND_MAX = 2600

SEA_OFFSET = 1000          # metres added before storing, so the sea floor (down to -SEA_OFFSET) fits in 16 bits
SCALE = 2                  # the map pictures are this many times the painting's size
SEED = 7                   # the noise's seed: the same painting always gives the same land

# The towns on the painting: the middle of the buildings, and the middle of the name's box (painting pixels). The land
# around them is kept low and even -- their buildings and boxes would otherwise read as rock.
TOWNS = [
    ('Grand Harbour', (70, 880), (97, 923)),
    ('Inex City', (365, 790), (375, 826)),
    ('Pax Cove', (525, 680), (528, 713)),
    ('Tuscara', (390, 1045), (399, 1082)),
    ('Starhaven', (530, 1045), (584, 1035)),
    ('Astria', (745, 1145), (781, 1122)),
    ('Constellar', (590, 1190), (627, 1216)),
]
# Names written on the water.
WATER_NAMES = [('Libra', (770, 1265))]
TOWN_RADIUS = 48


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def blur(mask, sigma):
    return ndi.gaussian_filter(mask.astype(np.float32), sigma)


def fractal(shape, rng, scales, ridged=False):
    """Sum of smooth value-noise layers, 0..1 (ridged: sharp crests, for mountains)."""
    h, w = shape
    total = np.zeros(shape, np.float32)
    amp_sum = 0
    for i, s in enumerate(scales):
        grid = rng.random((h // s + 3, w // s + 3)).astype(np.float32)
        layer = ndi.zoom(grid, s, order=3)[:h, :w]
        if ridged:
            layer = 1 - np.abs(layer * 2 - 1)
            layer = layer * layer
        amp = 0.55 ** i
        total += layer * amp
        amp_sum += amp
    return np.clip(total / amp_sum, 0, 1)


def classify(rgb):
    """What each pixel of the painting shows, from its colour."""
    r, g, b = (rgb[..., i].astype(np.float32) for i in range(3))
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    sat = (mx - mn) / np.maximum(mx, 1)
    val = mx / 255
    hue = np.zeros_like(r)
    d = np.maximum(mx - mn, 1e-3)
    hue = np.where(mx == r, ((g - b) / d) % 6, hue)
    hue = np.where(mx == g, (b - r) / d + 2, hue)
    hue = np.where(mx == b, (r - g) / d + 4, hue)
    hue = hue * 60

    water = (hue > 185) & (hue < 240) & (sat > 0.35) & (val > 0.2)
    white = (sat < 0.16) & (val > 0.8)                       # foam, snow, white walls
    cream = (r > 200) & (g > 180) & (b > 140) & (r - b > 18) & (sat < 0.35)  # the label boxes
    snow = white & (b >= r - 6)
    red = (r > 170) & (g < 80) & (b < 80)                    # the red dots and the roofs
    green = (hue > 55) & (hue < 170) & (sat > 0.25)
    forest = green & (val < 0.5)
    rock = ((sat < 0.3) & (val > 0.25) & ~water & ~cream) | ((hue > 10) & (hue < 45) & (sat > 0.2) & (sat < 0.6) & (val > 0.3) & (val < 0.75))
    road = (val < 0.3) & (hue > 0) & (hue < 50) & ~water
    lab, _ = ndi.label(road)
    sizes = ndi.sum(road, lab, range(1, lab.max() + 1))
    road = np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s >= 40])  # the tree shadows are specks
    return dict(water=water, white=white, cream=cream, snow=snow, red=red, forest=forest, rock=rock & ~road, road=road)


def find_blobs(mask, min_area, max_area):
    lab, n = ndi.label(mask)
    out = []
    for i, sl in enumerate(ndi.find_objects(lab), start=1):
        area = int((lab[sl] == i).sum())
        if min_area <= area <= max_area:
            cy, cx = ndi.center_of_mass(lab == i)
            out.append({'x': round(float(cx), 1), 'y': round(float(cy), 1), 'w': sl[1].stop - sl[1].start, 'h': sl[0].stop - sl[0].start, 'area': area})
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    painting = Image.open(SOURCE).convert('RGB')
    rgb = np.asarray(painting).copy()
    H, W = rgb.shape[:2]
    rng = np.random.default_rng(SEED)
    # The name boxes (and the names on the water) are filled with the colours just outside them before reading the
    # land, so a coast runs on underneath a box that sits half on the sea.
    yy, xx = np.mgrid[0:H, 0:W]
    boxes = np.zeros((H, W), bool)
    for _, _, (lx, ly) in TOWNS:
        boxes |= (np.abs(xx - lx) < 70) & (np.abs(yy - ly) < 22)
    for _, (x, y) in WATER_NAMES:
        boxes |= (np.abs(xx - x) < 45) & (np.abs(yy - y) < 20)
    _, (iy, ix) = ndi.distance_transform_edt(boxes, return_indices=True)
    rgb = rgb[iy, ix]
    c = classify(rgb)

    # --- The towns and the red dots: kept out of the rock / road reading ---
    towns = np.zeros((H, W), bool)
    for _, (bx, by), _ in TOWNS:
        towns |= (xx - bx) ** 2 + (yy - by) ** 2 < TOWN_RADIUS ** 2
    dots = [b for b in find_blobs(c['red'], 120, 700) if 0.6 < b['w'] / max(b['h'], 1) < 1.6]
    marks = towns | boxes      # (a filled box borrows its neighbours' colours: only its land / sea is trusted)
    for d in dots:
        marks |= (xx - d['x']) ** 2 + (yy - d['y']) ** 2 < 18 ** 2
    for key in ('rock', 'snow', 'road', 'forest'):
        c[key] = c[key] & ~marks

    # --- The sea: the water connected to the edge, the foam and small rocks closed into it ---
    # (the closing counts beyond the picture as dry, so the painting's own water is added back -- else the water at
    # the edges is eaten away and nothing touches the edge)
    water = ndi.binary_closing(c['water'] | (c['white'] & ndi.binary_dilation(c['water'], iterations=3)), iterations=2) | c['water']
    lab, _ = ndi.label(water)
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    sea = np.isin(lab, list(edge))
    # islets smaller than this vanish into the sea (stray rocks); bigger ones stay
    land = ~sea
    land_lab, _ = ndi.label(land)
    sizes = ndi.sum(land, land_lab, range(1, land_lab.max() + 1))
    keep = np.isin(land_lab, [i + 1 for i, s in enumerate(sizes) if s >= 60])
    land = keep
    # under the name boxes the filled-in coast is straight-edged: rounded off there
    near_boxes = ndi.binary_dilation(boxes, iterations=10)
    land = np.where(near_boxes, blur(land, 5) > 0.5, land)
    sea = ~land
    sea = ndi.binary_opening(sea, iterations=1) | (sea & ~ndi.binary_erosion(land, iterations=1))

    # --- Inland water: the lake (a big blob) and the rivers (thin lines) ---
    inland = c['water'] & land & ~marks
    in_lab, _ = ndi.label(inland)
    lake = np.zeros_like(inland)
    river = np.zeros_like(inland)
    for i, sl in enumerate(ndi.find_objects(in_lab), start=1):
        part = in_lab == i
        area = part.sum()
        thick = ndi.binary_erosion(part, iterations=4).sum()
        if thick > 400:
            lake |= ndi.binary_closing(part, iterations=3)
        elif area > 20:
            river |= part

    # --- Heights from what's painted ---
    coast_d = ndi.distance_transform_edt(land)          # pixels to the sea
    sea_d = ndi.distance_transform_edt(sea)
    forest_d = blur(c['forest'] & land, 7)
    rock_d = blur(c['rock'] & land & ~lake & ~river, 9)
    snow_d = blur(c['snow'] & land, 8)
    # the rocks and cliffs painted along the shore read as mountains -- seen from the side the coast stood up in walls
    # (2026-10-20): a mountain only rises away from the sea, fully ~1.7 km inland (as js/region-map/make-terrain.js)
    mountain = smoothstep(0.18, 0.62, rock_d + snow_d * 0.8) * smoothstep(0, 14, coast_d)
    ridges = fractal((H, W), rng, [64, 32, 16, 8, 4], ridged=True)
    hills = fractal((H, W), rng, [96, 48, 24, 12])

    h = 25 + 240 * (1 - np.exp(-coast_d / 70))            # low coasts, rising inland
    h += 140 * forest_d + 90 * (hills - 0.5)
    h += mountain * (900 + 1100 * ridges + 500 * smoothstep(0.1, 0.5, snow_d))
    h = ndi.gaussian_filter(h, 1.2)
    lake_level = float(np.percentile(h[ndi.binary_dilation(lake, iterations=4) & ~lake], 20)) - 6 if lake.any() else 0
    lake_depth = ndi.distance_transform_edt(lake)
    h = np.where(lake, lake_level - np.minimum(lake_depth * 2.5, 40), h)
    river_soft = blur(river, 1.5)
    h -= 30 * np.clip(river_soft * 3, 0, 1) * (1 - mountain * 0.7)
    h = np.where(land, np.minimum(h, 15 + 55 * coast_d), h)   # no higher than a steep slope up from the shore allows
    h = np.where(land, np.maximum(h, 3), -np.minimum(sea_d * 6 + 4, SEA_OFFSET - 10))
    h = np.where(land | (sea_d > 2), h, ndi.gaussian_filter(h, 1.0))

    if os.path.exists(HAND_HEIGHT):
        hand = np.asarray(Image.open(HAND_HEIGHT).convert('L').resize((W, H)), np.float32) / 255 * HAND_MAX
        h = np.where(land, np.maximum(hand, 3), h)
        print('using the hand-painted heights in', HAND_HEIGHT)

    kind = np.where(sea, 0, np.where(lake, 2, np.where(river, 3, 1))).astype(np.uint8)
    stored = np.clip(np.round(h + SEA_OFFSET), 0, 65535).astype(np.uint16)
    hm = np.dstack([(stored >> 8).astype(np.uint8), (stored & 255).astype(np.uint8), kind])
    Image.fromarray(hm, 'RGB').save(os.path.join(OUT, 'height.png'), optimize=True)

    # --- The map pictures, at SCALE x ---
    big_h = ndi.zoom(h, SCALE, order=3)
    hb, wb = big_h.shape
    def big(mask):
        return ndi.zoom(mask.astype(np.float32), SCALE, order=1)
    land_b, lake_b, river_b = big(land), big(lake), big(river)
    forest_b = ndi.zoom(forest_d, SCALE, order=1)
    road_b = big(ndi.binary_opening(c['road'] & land, iterations=1))

    # shading: light from the north-west, the slopes exaggerated so the relief shows
    gy, gx = np.gradient(big_h * 0.018)
    slope = np.pi / 2 - np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    az, alt = np.radians(315), np.radians(42)
    shade = np.sin(alt) * np.sin(slope) + np.cos(alt) * np.cos(slope) * np.cos(az - aspect)
    shade = np.clip(shade, 0, 1)

    stops = [(-1000, (24, 62, 112)), (-300, (38, 88, 146)), (-60, (70, 132, 186)), (-8, (132, 186, 220)), (0, (160, 205, 228)),
             (3, (122, 160, 98)), (150, (150, 182, 112)), (400, (206, 204, 142)), (800, (196, 166, 116)),
             (1300, (164, 126, 92)), (1800, (150, 138, 130)), (2300, (238, 238, 240)), (3200, (255, 255, 255))]
    xs = np.array([s[0] for s in stops], np.float32)
    topo = np.dstack([np.interp(big_h, xs, [s[1][i] for s in stops]) for i in range(3)]).astype(np.float32)
    forest_tint = np.array([84, 124, 72], np.float32)
    f = np.clip(forest_b * 1.4, 0, 0.55)[..., None] * land_b[..., None]
    topo = topo * (1 - f) + forest_tint * f
    shade_k = (0.55 + 0.65 * shade)[..., None]
    topo = np.where(land_b[..., None] > 0.5, topo * shade_k, topo * (0.92 + 0.12 * shade[..., None]))
    lake_col = np.array([78, 140, 196], np.float32)
    topo = topo * (1 - lake_b[..., None]) + lake_col * lake_b[..., None]
    rv = np.clip(ndi.gaussian_filter(river_b, 0.7) * 1.6, 0, 1)[..., None]
    topo = topo * (1 - rv) + np.array([70, 138, 205], np.float32) * rv
    coast = np.clip(ndi.gaussian_filter(land_b, 0.8), 0, 1)
    coast_line = (np.abs(coast - 0.5) < 0.22)[..., None] * 0.55
    topo = topo * (1 - coast_line) + np.array([40, 60, 70], np.float32) * coast_line
    rd = np.clip(ndi.gaussian_filter(road_b, 0.8) * 1.3, 0, 0.85)[..., None]
    topo = topo * (1 - rd) + np.array([110, 62, 32], np.float32) * rd
    Image.fromarray(np.clip(topo, 0, 255).astype(np.uint8)).save(os.path.join(OUT, 'topo.jpg'), quality=88, optimize=True)

    painted = np.asarray(painting.resize((wb, hb), Image.LANCZOS), np.float32)
    painted = np.where(land_b[..., None] > 0.5, painted * (0.8 + 0.35 * shade[..., None]), painted)
    Image.fromarray(np.clip(painted, 0, 255).astype(np.uint8)).save(os.path.join(OUT, 'painted.jpg'), quality=88, optimize=True)

    # --- What the viewer marks ---
    places = {
        'width': W, 'height': H, 'seaOffset': SEA_OFFSET, 'scale': SCALE,
        'towns': [{'name': n, 'x': bx, 'y': by} for n, (bx, by), _ in TOWNS],
        'spots': [{'x': d['x'], 'y': d['y']} for d in sorted(dots, key=lambda d: (d['y'], d['x']))],
        'water': [{'name': n, 'x': x, 'y': y} for n, (x, y) in WATER_NAMES],
    }
    with open(os.path.join(OUT, 'places.json'), 'w', encoding='utf-8') as fh:
        json.dump(places, fh, indent=1)

    print(f'{W}x{H}: land {land.mean():.0%}, lake {lake.sum()} px, rivers {river.sum()} px, highest {h.max():.0f} m, '
          f'deepest {h.min():.0f} m, {len(TOWNS)} towns, {len(dots)} spots')


if __name__ == '__main__':
    main()
