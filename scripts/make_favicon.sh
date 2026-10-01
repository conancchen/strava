#!/bin/sh
# Regenerates every favicon: Strava's two orange chevrons on a transparent
# background, traced from its logo path. Run from the repo root. Needs Pillow
# (pip install pillow).
python3 - <<'PY'
from PIL import Image, ImageDraw

ORANGE = (252, 76, 2, 255)
FILL = 0.92        # height of the chevrons, as a share of the canvas size
SUPERSAMPLE = 16

# The logo's two chevrons in its 24x24 box: the tall one, then the small one
CHEVRONS = [
    [(10.463, 0), (17.471, 13.828), (13.299, 13.828), (10.463, 8.229),
     (7.632, 13.828), (3.463, 13.828)],
    [(13.298, 13.828), (15.387, 17.944), (17.471, 13.828), (20.537, 13.828),
     (15.387, 24), (10.233, 13.828)],
]
LEFT, RIGHT, TOP, BOTTOM = 3.463, 20.537, 0, 24

def chevrons(size):
    big = size * SUPERSAMPLE
    img = Image.new("RGBA", (big, big), (255, 255, 255, 0))
    draw = ImageDraw.Draw(img)
    scale = FILL * big / (BOTTOM - TOP)
    dx = (big - (RIGHT - LEFT) * scale) / 2 - LEFT * scale
    dy = (big - (BOTTOM - TOP) * scale) / 2 - TOP * scale
    for shape in CHEVRONS:
        draw.polygon([(dx + x * scale, dy + y * scale) for x, y in shape], fill=ORANGE)
    return img.resize((size, size), Image.LANCZOS)

for name, size in [("favicon-16", 16), ("favicon-32", 32), ("favicon-192", 192),
                   ("apple-touch-icon", 180)]:
    chevrons(size).save(f"images/{name}.png")
PY
