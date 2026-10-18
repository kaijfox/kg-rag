"""Select inline math spans in the Kardar PDFs. The glyph-name text only exists in docling-parse's word cells,
so locate spans there (lparenori ... rparenori on one line) and crop the union box."""
import json, random, re
import pypdfium2 as pdfium
from docling_parse.pdf_parser import DoclingPdfParser
from docling_core.types.doc.page import TextCellUnit
from common import *
random.seed(7)
parser = DoclingPdfParser()
inline = []
for name, n in [("FoundationsKardar", 3), ("ThermoKardar", 3)]:
    pdf = pdfium.PdfDocument(str(CORPUS / f"{name}.pdf"))
    dp = parser.load(str(CORPUS / f"{name}.pdf"))
    cands = []
    for pno in range(2, min(len(pdf), 40) + 1):
        pg = dp.get_page(pno)
        cb = pg.dimension.crop_bbox
        words = [(c.text, c.rect.to_bounding_box()) for c in pg.iterate_cells(unit_type=TextCellUnit.WORD)]
        for i, (w, bb) in enumerate(words):
            if re.match(r"^(lparenori|lbraceori)", w):
                for j in range(i + 1, min(i + 14, len(words))):
                    wj, bj = words[j]
                    if abs(bj.b - bb.b) > 6 and abs(bj.t - bb.t) > 6: break
                    if re.search(r"(rparenori|rbraceori)", wj):
                        seg = words[i:j + 1]
                        txt = " ".join(x[0] for x in seg)
                        if 12 <= len(txt) <= 80 and len(seg) >= 4:
                            cands.append((pno, txt, min(x[1].l for x in seg) , max(x[1].r for x in seg) ,
                                          min(x[1].b for x in seg) , max(x[1].t for x in seg) ))
                        break
    random.shuffle(cands); seen = set(); picks = []
    for c in cands:
        if c[0] in seen: continue
        seen.add(c[0]); picks.append(c)
        if len(picks) == n: break
    for pno, txt, l, r, b, t in sorted(picks):
        bbox = {"l": l - 1, "r": r + 1, "t": t + 1, "b": b - 1}
        img = crop_page(pdf, pno, bbox, expand=0.04)
        gid = f"I{'F' if name.startswith('F') else 'T'}K-p{pno:02d}-{int(l)}"
        img.save(HERE / "crops" / f"{gid}.png")
        inline.append({"id": gid, "doc": name, "page": pno, "ref": "docling-parse words", "bbox": bbox, "orig": txt, "kind": "inline", "size": img.size})
g = json.load(open(HERE / "gold_selection.json"))
g = [x for x in g if x["kind"] != "inline"] + inline
json.dump(g, open(HERE / "gold_selection.json", "w"), indent=1, ensure_ascii=False)
for x in inline: print(x["id"], x["size"], x["orig"])
