"""Select ~30 display formulas (seeded, stratified) and render docling-equivalent crops."""
import json, random, re
import pypdfium2 as pdfium
from common import *
random.seed(20261018)
quota = {"FoundationsKardar": 8, "ThermoKardar": 8, "FoundationsPlischke": 7, "ThermoPlischke": 7}
gold = []
for name, n in quota.items():
    fs = formulas(name)
    # drop degenerate boxes; keep a mix: 2 'heavy' (long orig / brace / matrix-like), rest uniformly random over pages
    fs = [f for f in fs if (f["prov"][0]["bbox"]["r"] - f["prov"][0]["bbox"]["l"]) > 20]
    heavy = [f for f in fs if re.search(r"[⎧⎪⎨⎩⎛⎜⎝]|matrix|\\sum|Σ", f["orig"]) or len(f["orig"]) > 110]
    pick = random.sample(heavy, min(2, len(heavy)))
    rest = [f for f in fs if f not in pick]
    pick += random.sample(rest, n - len(pick))
    pdf = pdfium.PdfDocument(str(CORPUS / f"{name}.pdf"))
    for f in sorted(pick, key=lambda f: f["prov"][0]["page_no"]):
        p = f["prov"][0]
        gid = f"{name[:2]}{name.replace('Foundations','').replace('Thermo','')[:2]}-p{p['page_no']:02d}-{f['self_ref'].split('/')[-1]}"
        gid = f"{'F' if name.startswith('F') else 'T'}{'K' if 'Kardar' in name else 'P'}-p{p['page_no']:02d}-t{f['self_ref'].split('/')[-1]}"
        img = crop_page(pdf, p["page_no"], p["bbox"])
        img.save(HERE / "crops" / f"{gid}.png")
        gold.append({"id": gid, "doc": name, "page": p["page_no"], "ref": f["self_ref"], "bbox": p["bbox"], "orig": f["orig"], "kind": "display", "size": img.size})
json.dump(gold, open(HERE / "gold_selection.json", "w"), indent=1, ensure_ascii=False)
print(len(gold))
for g in gold: print(g["id"], g["size"], g["orig"][:70])
