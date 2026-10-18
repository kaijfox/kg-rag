"""Ollama vision model (default qwen3.5, already installed; no download). POST /api/chat with base64 images, think=false, temperature 0.
usage: run_ollama.py TAG MODEL [limit]"""
import json, sys, time, base64, os, urllib.request
from common import HERE
CROPS = os.environ.get("CROPS", "crops")
tag, model = sys.argv[1:3]; limit = int(sys.argv[3]) if len(sys.argv) > 3 else None
gold = json.load(open(HERE / "gold.json"))[:limit]
PROMPT = "Transcribe the mathematical formula in this image as LaTeX. Output only the LaTeX code, no explanation, no surrounding prose."
def one(g):
    b = base64.b64encode(open(HERE / CROPS / f"{g['id']}.png", "rb").read()).decode()
    body = {"model": model, "stream": False, "think": False, "options": {"temperature": 0, "num_predict": 1024},
            "messages": [{"role": "user", "content": PROMPT, "images": [b]}]}
    req = urllib.request.Request("http://localhost:11434/api/chat", json.dumps(body).encode(), {"Content-Type": "application/json"})
    t = time.time(); r = json.load(urllib.request.urlopen(req, timeout=600)); dt = time.time() - t
    return r["message"]["content"], dt, r.get("eval_count")
for g in gold[:1]: one(g)
res = {}
for g in gold:
    txt, dt, n = one(g)
    res[g["id"]] = {"text": txt, "s": dt, "gen_tokens": n, "peak_gb": None}
    print(g["id"], f"{dt:.1f}s", n, repr(txt[:90]), flush=True)
json.dump({"tag": tag, "repo": "ollama:" + model, "prompt": PROMPT, "load_s": None, "results": res}, open(HERE / "out" / f"{tag}.json", "w"), indent=1, ensure_ascii=False)
