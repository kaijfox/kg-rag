"""Does docling's own formula stage run on Apple GPU via the granite_docling preset (MLX engine)? One page of ThermoPlischke."""
import time, os
os.environ["HF_HOME"] = os.path.expanduser("~/.cache/kgrag-spike-formula/hf")
from docling.document_converter import DocumentConverter, PdfFormatOption
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions, CodeFormulaVlmOptions
from common import CORPUS
opts = PdfPipelineOptions(do_ocr=False, do_formula_enrichment=True)
opts.code_formula_options = CodeFormulaVlmOptions.from_preset("granite_docling")
print("engine:", opts.code_formula_options.engine_options)
conv = DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opts)})
t = time.time(); res = conv.convert(str(CORPUS / "ThermoPlischke.pdf"), page_range=(10, 10)); print("convert s", time.time() - t)
fs = [x for x in res.document.texts if x.label.value == "formula"]
print(len(fs), "formulas"); [print(repr(x.text[:100])) for x in fs[:4]]
