"""Score every out/<candidate>.json against gold.json. Metrics per candidate:
exact (normalized-token exact match), ned (mean normalized token edit distance), render (pdflatex bitmap identical to the reference),
each in 'lenient' (candidate's \\text/\\intertext fragments dropped, i.e. prose copied from the crop margins ignored) and 'strict' mode."""
import json, glob, os, re, statistics as st, sys
from latexnorm import *
gold = json.load(open(HERE_ := os.path.dirname(os.path.abspath(__file__)) + "/gold.json"))
WORK = "/private/tmp/claude-501/-Users-kaifox-projects-obsidian-kg-rag/1b765c74-0cfb-4811-89c5-66707ac0a9ad/scratchpad/render"
def strip_text_tex(s):
    return re.sub(r"\\(text|intertext|mbox)\s*\{[^{}]*\}", " ", clean(s))
ref_render = dict(zip([g["id"] for g in gold], render_many([strip_text_tex(g["reference"]) for g in gold], WORK)))
files = sorted(f for f in glob.glob(HERE_.replace("gold.json", "") + "out/*.json") if not os.path.basename(f).startswith(("ref_", "scores")))
# docling CPU run (batch 5) as a candidate in the same format
cpu = json.load(open(HERE_.replace("gold.json", "") + "out/ref_cpu_all.json"))
rows = []
cands = {os.path.basename(f)[:-5]: json.load(open(f)) for f in files if "results" in json.load(open(f)) and not os.path.basename(f).startswith("full_")}
cands["docling_codeformulav2_cpu_bf16_batch5"] = {"results": {g["id"]: {"text": cpu[g["id"]], "s": None} for g in gold}, "load_s": None}
for name, c in cands.items():
    R = c["results"]; kinds = {}
    out = {"name": name, "n": len(gold)}
    for mode, strip in (("lenient", True), ("strict", False)):
        ex = [exact(R[g["id"]]["text"], g["reference"], strip) for g in gold]
        nd = [ned(R[g["id"]]["text"], g["reference"], strip) for g in gold]
        tex = [strip_text_tex(R[g["id"]]["text"]) if strip else clean(R[g["id"]]["text"]) for g in gold]
        rr = render_many(tex, WORK)
        rend = [a is not None and a == ref_render[g["id"]] for a, g in zip(rr, gold)]
        out[mode] = {"exact": sum(ex), "ned_mean": st.mean(nd), "render_equal": sum(rend), "compile_fail": sum(a is None for a in rr),
                     "exact_display": sum(e for e, g in zip(ex, gold) if g["kind"] == "display"), "exact_inline": sum(e for e, g in zip(ex, gold) if g["kind"] == "inline"),
                     "per_item": {g["id"]: {"exact": e, "ned": d, "render": r_} for g, e, d, r_ in zip(gold, ex, nd, rend)}}
    ts = [R[g["id"]]["s"] for g in gold if R[g["id"]].get("s") is not None]
    out["latency_median_s"] = st.median(ts) if ts else None
    out["latency_mean_display_s"] = st.mean([R[g["id"]]["s"] for g in gold if g["kind"] == "display"]) if ts else None
    out["latency_max_s"] = max(ts) if ts else None
    pk = [R[g["id"]].get("peak_gb") for g in gold if R[g["id"]].get("peak_gb")]
    out["peak_gb"] = max(pk) if pk else None
    out["load_s"] = c.get("load_s")
    rows.append(out)
json.dump(rows, open(HERE_.replace("gold.json", "") + "out/scores.json", "w"), indent=1)
print(f"{'candidate':44s} lenient ex/ned/rend | strict ex/ned/rend | med_s mean_disp_s peak_gb")
for o in rows:
    l, s = o["lenient"], o["strict"]
    f = lambda x: "-" if x is None else f"{x:.2f}"
    print(f"{o['name']:44s} {l['exact']:2d} {l['ned_mean']:.3f} {l['render_equal']:2d} | {s['exact']:2d} {s['ned_mean']:.3f} {s['render_equal']:2d} | {f(o['latency_median_s'])} {f(o['latency_mean_display_s'])} {f(o['peak_gb'])}")
