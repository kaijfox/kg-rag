"""texify (vikp/texify) via the texify package. usage: run_texify.py TAG DEVICE(mps|cpu)"""
import json, sys, time, torch
from PIL import Image
from common import HERE
import os; CROPS = os.environ.get("CROPS", "crops")
tag, dev = sys.argv[1:3]
import texify.settings as ts
ts.settings.TORCH_DEVICE = dev
from texify.model.model import load_model
from texify.model.processor import load_processor
from texify.inference import batch_inference
gold = json.load(open(HERE / "gold.json"))
t0 = time.time(); model = load_model(); processor = load_processor(); load_s = time.time() - t0
print("device", model.device, model.dtype, flush=True)
def sync():
    if dev == "mps": torch.mps.synchronize()
def one(g):
    img = Image.open(HERE / CROPS / f"{g['id']}.png")
    t = time.time(); out = batch_inference([img], model, processor); sync()
    return out[0], time.time() - t
for g in gold[:2]: one(g)
res = {}
for g in gold:
    if dev == "mps": torch.mps.empty_cache()
    txt, dt = one(g)
    res[g["id"]] = {"text": txt, "s": dt, "peak_gb": (torch.mps.driver_allocated_memory() / 1e9) if dev == "mps" else None}
    print(g["id"], f"{dt:.2f}s", repr(txt[:100]), flush=True)
json.dump({"tag": tag, "repo": "vikp/texify", "prompt": None, "load_s": load_s, "results": res}, open(HERE / "out" / f"{tag}.json", "w"), indent=1, ensure_ascii=False)
