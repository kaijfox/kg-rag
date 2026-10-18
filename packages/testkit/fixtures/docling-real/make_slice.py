import sys, time, hashlib, pathlib, json, platform
from importlib.metadata import version
from docling.document_converter import DocumentConverter, PdfFormatOption
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions
pdf, first, last, out = pathlib.Path(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3]), pathlib.Path(sys.argv[4])
opts = PdfPipelineOptions(do_ocr=False, do_table_structure=True)
conv = DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opts)})
dv = version("docling")
sha = hashlib.sha256(pdf.read_bytes()).hexdigest()
t = time.time(); doc = conv.convert(str(pdf), page_range=(first, last)).document; dt = time.time() - t
d = doc.export_to_dict(); md = doc.export_to_markdown()
env = {"format": "kg-parse-artifact/1", "sourceSha256": sha, "sourceName": pdf.name,
       "recipe": {"kind": "parse", "version": "1", "spec": {"parser": "docling", "doclingVersion": dv,
                  "options": {"do_ocr": False, "do_table_structure": True, "do_formula_enrichment": False, "page_range": [first, last]}}},
       "parser": {"name": "docling", "version": dv},
       "producedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "producedOn": "phase1-fixture",
       "stats": {"pages": len(d.get("pages", {})), "chars": len(md), "charsPerPage": [], "undecodedFormulas": md.count("formula-not-decoded"), "elapsedMs": int(dt*1000)},
       "document": d}
out.write_text(json.dumps(env, indent=1))
print("RESULT", out.name, "pages", sorted(int(k) for k in d["pages"]), "texts", len(d["texts"]), "tables", len(d["tables"]), "pictures", len(d["pictures"]), "groups", len(d["groups"]))
