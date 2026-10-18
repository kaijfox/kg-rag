"""Same gold crops with a 4% instead of 18% margin (docling exposes this as CodeFormulaVlmOptions.expansion_factor)."""
import json, pypdfium2 as pdfium, shutil
from common import *
gold = json.load(open(HERE / "gold.json"))
pdfs = {}
for g in gold:
    if g["kind"] == "inline": shutil.copy(HERE / "crops" / f"{g['id']}.png", HERE / "crops_tight" / f"{g['id']}.png"); continue
    pdf = pdfs.setdefault(g["doc"], pdfium.PdfDocument(str(CORPUS / f"{g['doc']}.pdf")))
    crop_page(pdf, g["page"], g["bbox"], expand=0.04).save(HERE / "crops_tight" / f"{g['id']}.png")
