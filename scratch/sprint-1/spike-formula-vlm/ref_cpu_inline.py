"""Reference: docling's own CodeFormulaVlmModel stage (CodeFormulaV2, transformers engine, CPU, bf16, batch 5) on the gold crops."""
import json, time, sys
from PIL import Image
from docling.datamodel.accelerator_options import AcceleratorOptions, AcceleratorDevice
from docling.datamodel.pipeline_options import CodeFormulaVlmOptions
from docling.models.stages.code_formula.code_formula_vlm_model import CodeFormulaVlmModel
from docling.models.base_model import ItemAndImageEnrichmentElement
from docling_core.types.doc import DocItemLabel, FormulaItem
from common import HERE
gold = [g for g in json.load(open(HERE / "gold_selection.json")) if g["kind"] == "inline"]
opts = CodeFormulaVlmOptions.from_preset("codeformulav2")
stage = CodeFormulaVlmModel(enabled=True, enable_remote_services=False, artifacts_path=None, options=opts,
                            accelerator_options=AcceleratorOptions(device=AcceleratorDevice.CPU, num_threads=8))
print("engine", opts.engine_options.engine_type, flush=True)
out = {}; times = {}
for i in range(0, len(gold), 5):
    batch = gold[i:i+5]
    els = [ItemAndImageEnrichmentElement(item=FormulaItem(self_ref="#/texts/0", label=DocItemLabel.FORMULA, orig="", text=""), image=Image.open(HERE/"crops"/f"{g['id']}.png")) for g in batch]
    t = time.time()
    res = list(stage(None, els))
    dt = time.time() - t
    for g, r in zip(batch, res):
        out[g["id"]] = r.text; times[g["id"]] = dt / len(batch)
    print(i, f"{dt:.1f}s", [r.text[:60] for r in res], flush=True)
json.dump({"latex": out, "batch_time_per_item_s": times}, open(HERE/"out/ref_cpu_inline.json", "w"), indent=1, ensure_ascii=False)
