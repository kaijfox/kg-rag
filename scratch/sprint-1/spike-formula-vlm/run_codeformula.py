"""docling-project/CodeFormulaV2 via transformers (same prompt/post-processing as docling's CodeFormulaVlmModel) on mps or cpu, batch 1.
usage: run_codeformula.py TAG DEVICE DTYPE"""
import json, sys, time, os, torch
from PIL import Image
from transformers import AutoProcessor, AutoModelForImageTextToText
from common import HERE
CROPS = os.environ.get("CROPS", "crops")
tag, dev, dt_name = sys.argv[1:4]
dtype = {"bf16": torch.bfloat16, "fp16": torch.float16, "fp32": torch.float32}[dt_name]
gold = json.load(open(HERE / "gold.json"))
t0 = time.time()
proc = AutoProcessor.from_pretrained("docling-project/CodeFormulaV2")
model = AutoModelForImageTextToText.from_pretrained("docling-project/CodeFormulaV2", dtype=dtype).to(dev).eval()
load_s = time.time() - t0
msgs = [{"role": "user", "content": [{"type": "image"}, {"type": "text", "text": "<formula>"}]}]
prompt = proc.apply_chat_template(msgs, add_generation_prompt=True)
def sync():
    if dev == "mps": torch.mps.synchronize()
def one(g):
    img = Image.open(HERE / CROPS / f"{g['id']}.png").convert("RGB")
    inp = proc(text=[prompt], images=[img], return_tensors="pt").to(dev)
    inp = {k: (v.to(dtype) if v.dtype.is_floating_point else v) for k, v in inp.items()}
    t = time.time()
    with torch.no_grad():
        ids = model.generate(**inp, max_new_tokens=1024, do_sample=False, use_cache=True)
    sync(); dt = time.time() - t
    n = ids.shape[1] - inp["input_ids"].shape[1]
    txt = proc.batch_decode(ids[:, inp["input_ids"].shape[1]:], skip_special_tokens=False)[0]
    txt = txt.split("<end_of_utterance>")[0]
    for k in ["</code>", "</formula>", "<loc_0><loc_0><loc_500><loc_500>"]: txt = txt.replace(k, "")
    return txt.lstrip(), dt, n
for g in gold[:2]: one(g)
res = {}
for g in gold:
    txt, dt, n = one(g)
    res[g["id"]] = {"text": txt, "s": dt, "gen_tokens": n, "peak_gb": (torch.mps.driver_allocated_memory() / 1e9) if dev == "mps" else None}
    print(g["id"], f"{dt:.2f}s", n, repr(txt[:90]), flush=True)
json.dump({"tag": tag, "repo": "docling-project/CodeFormulaV2", "prompt": "<formula>", "load_s": load_s, "results": res}, open(HERE / "out" / f"{tag}.json", "w"), indent=1, ensure_ascii=False)
