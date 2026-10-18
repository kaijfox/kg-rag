"""Shared helpers for the formula-VLM spike. Run with the venv python at ~/.cache/kgrag-spike-formula/venv."""
import gzip, json, os, pathlib
HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parents[2]
CORPUS = REPO / "test/corpa/stat-mech"
DOCS = ["FoundationsKardar", "FoundationsPlischke", "ThermoKardar", "ThermoPlischke"]
CACHE = pathlib.Path.home() / ".cache/kgrag-spike-formula"

def load_artifact(name):
    return json.load(gzip.open(CORPUS / "artifacts" / f"{name}.kgparse.json.gz"))["document"]

def formulas(name):
    doc = load_artifact(name)
    return [t for t in doc["texts"] if t["label"] == "formula"]

def crop_page(pdf, page_no, bbox, scale=1.67, expand=0.18):
    """Reproduce docling CodeFormulaModel crop: page at scale 1.67, bbox expanded by 18% of w/h each side."""
    import pypdfium2 as pdfium
    pg = pdf[page_no - 1]
    W, H = pg.get_size()
    l, r, t, b = bbox["l"], bbox["r"], bbox["t"], bbox["b"]   # BOTTOMLEFT origin, t > b
    w, h = r - l, t - b
    l2, r2, t2, b2 = l - expand * w, r + expand * w, t + expand * h, b - expand * h
    img = pg.render(scale=scale).to_pil().convert("RGB")
    s = scale
    box = (max(0, int(l2 * s)), max(0, int((H - t2) * s)), min(img.width, int(r2 * s)), min(img.height, int((H - b2) * s)))
    return img.crop(box)
