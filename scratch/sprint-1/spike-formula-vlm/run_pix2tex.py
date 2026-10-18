"""pix2tex (LaTeX-OCR). usage: run_pix2tex.py TAG DEVICE(mps|cpu)"""
import json, sys, time, torch
from PIL import Image
from common import HERE
import os; CROPS = os.environ.get("CROPS", "crops")
tag, dev = sys.argv[1:3]
from pix2tex.cli import LatexOCR
gold = json.load(open(HERE / "gold.json"))
t0 = time.time(); m = LatexOCR(); m.args.temperature = 1e-5
if dev == "mps":
    m.args.device = "mps"; m.model.to("mps"); m.args.no_cuda = False
    if hasattr(m, "image_resizer") and m.image_resizer is not None: m.image_resizer.to("mps")
load_s = time.time() - t0
print("device", m.args.device, flush=True)
def one(g):
    img = Image.open(HERE / CROPS / f"{g['id']}.png").convert("RGB")
    t = time.time(); out = m(img, resize=True)
    if dev == "mps": torch.mps.synchronize()
    return out, time.time() - t
for g in gold[:2]: one(g)
res = {}
for g in gold:
    txt, dt = one(g)
    res[g["id"]] = {"text": txt, "s": dt, "peak_gb": (torch.mps.driver_allocated_memory() / 1e9) if dev == "mps" else None}
    print(g["id"], f"{dt:.2f}s", repr(txt[:100]), flush=True)
json.dump({"tag": tag, "repo": "pix2tex", "prompt": None, "load_s": load_s, "results": res}, open(HERE / "out" / f"{tag}.json", "w"), indent=1, ensure_ascii=False)
