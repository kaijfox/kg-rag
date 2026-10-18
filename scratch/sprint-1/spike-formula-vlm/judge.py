"""LLM semantic-equivalence judge (local Ollama qwen3.5, think:false, temperature 0) over saved candidate outputs vs gold references.
usage: judge.py  -> out/judge.json (cache + summary)"""
import json, re, os, urllib.request
from pathlib import Path
HERE = Path(__file__).resolve().parent
gold = json.load(open(HERE / "gold.json"))
scores = {r["name"]: r for r in json.load(open(HERE / "out/scores.json"))}
CANDS = ["glm_ocr_4bit_mlx", "glm_ocr_4bit_mlx_tight", "paddleocr_vl_1.6_4bit_mlx", "paddleocr_vl_1.6_4bit_mlx_tight",
         "codeformulav2_mps_bf16", "codeformulav2_mps_bf16_tight", "granite_docling_258m_mlx", "granite_docling_258m_mlx_tight",
         "texify_mps", "texify_mps_tight", "qwen3_vl_2b_4bit_mlx", "qwen3_vl_2b_4bit_mlx_tight"]
Q = "Do these two LaTeX expressions denote the same mathematical statement? Ignore formatting/notation style differences. Answer same / minor-difference / different"
def strip(s):
    s = s.strip()
    s = re.sub(r"^\s*(\$\$|\\\[|\\\(|\$)|(\$\$|\\\]|\\\)|\$)\s*$", "", s).strip()
    s = re.sub(r"^\\begin\{(equation|align|displaymath)\*?\}|\\end\{(equation|align|displaymath)\*?\}$", "", s).strip()
    return s
def ask(ref, cand):
    msg = f"{Q}\n\nReference:\n{ref}\n\nCandidate:\n{cand}\n\nAnswer with exactly one of: same, minor-difference, different."
    body = {"model": "qwen3.5:latest", "stream": False, "think": False, "options": {"temperature": 0, "seed": 0},
            "messages": [{"role": "user", "content": msg}]}
    r = urllib.request.Request("http://localhost:11434/api/chat", json.dumps(body).encode(), {"Content-Type": "application/json"})
    out = json.load(urllib.request.urlopen(r, timeout=300))["message"]["content"].strip().lower()
    for v in ("minor-difference", "minor difference", "different", "same"):
        if out.startswith(v) or v in out[:30]: return "minor-difference" if v.startswith("minor") else v, out
    return "unparsed", out
cache_p = HERE / "out/judge_cache.json"
cache = json.load(open(cache_p)) if cache_p.exists() else {}
res = {}
for c in CANDS:
    R = json.load(open(HERE / f"out/{c}.json"))["results"]; res[c] = {}
    for g in gold:
        ref, cand = strip(g["reference"]), strip(R[g["id"]]["text"])
        k = json.dumps([ref, cand])
        if k not in cache: cache[k] = ask(ref, cand)
        res[c][g["id"]] = {"verdict": cache[k][0], "raw": cache[k][1], "cand": cand}
    json.dump(cache, open(cache_p, "w"))
    v = [x["verdict"] for x in res[c].values()]
    print(f"{c:36s} same {v.count('same'):2d} minor {v.count('minor-difference'):2d} diff {v.count('different'):2d} unparsed {v.count('unparsed')}  exact(lenient) {scores[c]['lenient']['exact']}", flush=True)
json.dump(res, open(HERE / "out/judge.json", "w"), indent=1, ensure_ascii=False)
