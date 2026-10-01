#!/bin/sh
# Regenerates every favicon: half a yin-yang (the white half, outlined in
# black, with both dots black), turned 45 degrees, on a transparent background,
# matching the main site's. Run from the repo root. Needs Pillow
# (pip install pillow).
python3 - <<'PY'
from math import cos, sin, radians
from PIL import Image, ImageDraw

RADIUS = 0.308 # radius of the whole yin-yang circle, as a share of the canvas size
EYE = 0.2      # dot radius, as a share of RADIUS
RING = 0.05    # black outline width, as a share of RADIUS, so the white half
               # still reads on a light tab bar
ROTATE = 45    # turn it this many degrees clockwise
SUPERSAMPLE = 16

def disc(draw, cx, cy, r, fill):
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill)

def yinyang(size):
    big = size * SUPERSAMPLE
    img = Image.new("RGBA", (big, big), (255, 255, 255, 0))
    draw = ImageDraw.Draw(img)
    c = big / 2
    r = RADIUS * big
    white, black = (255, 255, 255, 255), (0, 0, 0, 255)
    # The white half's edge: down the right of the rim, back up round the
    # right of the bottom bulb to the middle, and up round the left of the top
    # bulb to where it started
    def arc(cx, cy, rad, start, end, steps=200):
        return [(cx + rad * cos(radians(start + (end - start) * i / steps)),
                 cy + rad * sin(radians(start + (end - start) * i / steps)))
                for i in range(steps + 1)]
    edge = (arc(c, c, r, -90, 90) + arc(c, c + r / 2, r / 2, 90, -90)
            + arc(c, c - r / 2, r / 2, 90, 270))
    draw.polygon(edge, fill=white)
    draw.line(edge + edge[:2], fill=black, width=round(RING * r), joint="curve")
    # Its own dot in the top bulb, and the dot floating where the other
    # half's would be, both black
    disc(draw, c, c - r / 2, EYE * r, black)
    disc(draw, c, c + r / 2, EYE * r, black)
    img = img.rotate(-ROTATE, resample=Image.BICUBIC)
    return img.resize((size, size), Image.LANCZOS)

for name, size in [("favicon-16", 16), ("favicon-32", 32), ("favicon-192", 192),
                   ("apple-touch-icon", 180)]:
    yinyang(size).save(f"images/{name}.png")
PY
