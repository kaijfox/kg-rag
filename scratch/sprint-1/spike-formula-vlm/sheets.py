import json, sys
from PIL import Image, ImageDraw
from common import HERE
g = json.load(open(HERE / "gold_selection.json"))
ids = [x["id"] for x in g]
N = int(sys.argv[1]) if len(sys.argv) > 1 else 6
for k in range(0, len(ids), N):
    ims = [Image.open(HERE / "crops" / f"{i}.png") for i in ids[k:k+N]]
    W = max(i.width for i in ims) + 10; H = sum(i.height + 22 for i in ims)
    s = Image.new("RGB", (W, H), "white"); d = ImageDraw.Draw(s); y = 0
    for i, im in zip(ids[k:k+N], ims):
        d.text((2, y + 4), i, fill="red"); s.paste(im, (5, y + 18)); y += im.height + 22
    s.save(HERE / "out" / f"sheet_{k//N:02d}.png")
print(len(ids))
