"""Run one mlx-vlm model over the gold crops. usage: run_mlx.py TAG REPO PROMPT [ids-limit]
Records per-crop wall latency (after 2 warm-up generations), generated tokens, peak MLX memory."""
import json, sys, time, os
import mlx.core as mx
from mlx_vlm import load, generate
from mlx_vlm.prompt_utils import apply_chat_template
from mlx_vlm.utils import load_config
from common import HERE
import os; CROPS = os.environ.get("CROPS", "crops")
tag, repo, prompt = sys.argv[1:4]
limit = int(sys.argv[4]) if len(sys.argv) > 4 else None
gold = json.load(open(HERE / "gold.json"))
if limit: gold = gold[:limit]
t0 = time.time(); model, processor = load(repo); config = load_config(repo)
load_s = time.time() - t0
fmt = apply_chat_template(processor, config, prompt, num_images=1)
def run(img):
    mx.reset_peak_memory()
    t = time.time()
    r = generate(model, processor, fmt, [str(img)], max_tokens=1024, temperature=0.0, verbose=False)
    return r, time.time() - t
for g in gold[:2]: run(HERE / CROPS / f"{g['id']}.png")   # warm-up
res = {}
for g in gold:
    r, dt = run(HERE / CROPS / f"{g['id']}.png")
    res[g["id"]] = {"text": r.text, "s": dt, "gen_tokens": r.generation_tokens, "peak_gb": mx.get_peak_memory() / 1e9, "finish": r.finish_reason}
    print(g["id"], f"{dt:.2f}s", r.generation_tokens, repr(r.text[:100]), flush=True)
json.dump({"tag": tag, "repo": repo, "prompt": prompt, "load_s": load_s, "results": res}, open(HERE / "out" / f"{tag}.json", "w"), indent=1, ensure_ascii=False)
