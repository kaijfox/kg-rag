import sys, time, hashlib, pathlib, json, platform
import docling
from importlib.metadata import version
from docling.document_converter import DocumentConverter, PdfFormatOption
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.chunking import HybridChunker
out = pathlib.Path(sys.argv[1]); out.mkdir(exist_ok=True, parents=True)
opts = PdfPipelineOptions(do_ocr=False, do_table_structure=True)
conv = DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opts)})
dv = version("docling")
for pdf in sys.argv[2:]:
    p = pathlib.Path(pdf); name = p.stem
    sha = hashlib.sha256(p.read_bytes()).hexdigest()
    t = time.time(); doc = conv.convert(str(p)).document; dt = time.time() - t
    d = doc.export_to_dict()
    md = doc.export_to_markdown()
    pages = len(d.get("pages", {}))
    env = {"format": "kg-parse-artifact/1", "sourceSha256": sha, "sourceName": p.name,
           "recipe": {"kind": "parse", "version": "1", "spec": {"parser": "docling", "doclingVersion": dv,
                      "options": {"do_ocr": False, "do_table_structure": True, "do_formula_enrichment": False}}},
           "parser": {"name": "docling", "version": dv},
           "producedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "producedOn": platform.node(),
           "stats": {"pages": pages, "chars": len(md), "charsPerPage": [], "undecodedFormulas": md.count("formula-not-decoded"), "elapsedMs": int(dt*1000)},
           "document": d}
    (out / f"{name}.kgparse.json").write_text(json.dumps(env))
    chunks = []
    for c in HybridChunker().chunk(doc):
        chunks.append({"text": c.text, "headings": c.meta.headings or [], "refs": [it.self_ref for it in c.meta.doc_items]})
    (out / f"{name}.hybrid.json").write_text(json.dumps(chunks))
    print(f"RESULT {name}: parse={dt:.1f}s pages={pages} chars={len(md)} hybrid_chunks={len(chunks)} formulas={md.count('formula-not-decoded')}", flush=True)
