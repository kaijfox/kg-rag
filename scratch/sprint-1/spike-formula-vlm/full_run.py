"""Decode all 605 display formulas of the four stat-mech PDFs with one mlx-vlm model; crops generated in memory (docling default crop).
usage: full_run.py TAG REPO PROMPT. Writes out/full_<TAG>.json keyed by '<doc>#<self_ref>'."""
import json, sys, time, io, tempfile, os
import mlx.core as mx, pypdfium2 as pdfium
from mlx_vlm import load, generate
from mlx_vlm.prompt_utils import apply_chat_template
from mlx_vlm.utils import load_config
from common import *
tag, repo, prompt = sys.argv[1:4]
model, processor = load(repo); config = load_config(repo)
fmt = apply_chat_template(processor, config, prompt, num_images=1)
tmp = tempfile.mkdtemp(prefix="fullrun_", dir="/private/tmp/claude-501/-Users-kaifox-projects-obsidian-kg-rag/1b765c74-0cfb-4811-89c5-66707ac0a9ad/scratchpad")
res = {}; t_all = time.time(); n = 0; mx.reset_peak_memory()
for name in DOCS:
    pdf = pdfium.PdfDocument(str(CORPUS / f"{name}.pdf"))
    for f in formulas(name):
        p = f["prov"][0]; img = crop_page(pdf, p["page_no"], p["bbox"]); path = f"{tmp}/c.png"; img.save(path)
        t = time.time()
        try:
            r = generate(model, processor, fmt, [path], max_tokens=1024, temperature=0.0, verbose=False)
            res[f"{name}#{f['self_ref']}"] = {"page": p["page_no"], "text": r.text, "s": time.time() - t, "tokens": r.generation_tokens, "finish": r.finish_reason}
        except Exception as e:
            res[f"{name}#{f['self_ref']}"] = {"page": p["page_no"], "error": repr(e)[:200], "s": time.time() - t}
        n += 1
        if n % 50 == 0: print(n, f"{time.time()-t_all:.0f}s", flush=True)
json.dump({"tag": tag, "total_s": time.time() - t_all, "peak_gb": mx.get_peak_memory() / 1e9, "results": res}, open(HERE / "out" / f"full_{tag}.json", "w"), ensure_ascii=False)
print("done", n, time.time() - t_all, mx.get_peak_memory() / 1e9)
