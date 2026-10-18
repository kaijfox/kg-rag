"""LaTeX normalization + metrics + render check for the formula spike. Normalization is deliberately modest and documented in results.md."""
import re, subprocess, tempfile, os, hashlib, pathlib, concurrent.futures as cf
from rapidfuzz.distance import Levenshtein

FUNCS = "ln log exp sin cos tan sinh cosh tanh sec csc cot arcsin arccos arctan lim max min sup inf det dim ker deg gcd hom arg Pr".split()
TOK = re.compile(r"\\[A-Za-z]+|\\.|[A-Za-z0-9]|[^\sA-Za-z0-9\\]")

def clean(s: str) -> str:
    """Strip model markup, math delimiters, equation numbers. If a model mixed prose and $$..$$ blocks, keep only the math blocks."""
    s = re.sub(r"<[^>]*>", "", s).strip()
    blocks = re.findall(r"\$\$(.+?)\$\$", s, flags=re.S)
    if blocks and not s.startswith("$$") or len(blocks) > 1:
        s = " \\\\ ".join(b.strip() for b in blocks) if blocks else s
    s = s.strip()
    s = re.sub(r"^\\\[|\\\]$|^\$\$|\$\$$|^\$|\$$|^\\\(|\\\)$", "", s).strip()
    s = re.sub(r"\\begin\{(equation\*?|displaymath)\}|\\end\{(equation\*?|displaymath)\}", "", s)
    s = re.sub(r"\\tag\*?\s*\{[^}]*\}", "", s)
    s = re.sub(r"\\eqno", " ", s)
    s = re.sub(r"\(\s*\d(?:\s*\d)*\s*\.\s*\d(?:\s*\d)*\s*\)", " ", s)
    s = re.sub(r"(?:\\q?quad|\\;|\\,|\\ |\s)*(?:\\text\{|\\mathrm\{)?\s*\(\s*\d(?:\s*\d)*\s*\.\s*\d(?:\s*\d)*\s*\)\s*\}?\s*\.?\s*$", "", s)
    return s.strip()

STYLE = r"mathrm|mathbf|mathit|mathsf|mathcal|cal|bf|rm|it|boldsymbol|bm|mathbb|mathfrak|textbf|textit"
def tokens(s: str, strip_text: bool = False):
    s = clean(s)
    if strip_text:   # drop neighbor-prose fragments some models transcribe from the crop margins
        s = re.sub(r"\\(text|intertext|mbox)\s*\{[^{}]*\}", " ", s)
    else:
        s = re.sub(r"\\(text|textrm|mbox)\s*\{([^{}]*)\}", lambda m: " \\" + m.group(2).replace(" ", "") + " " if m.group(2).replace(" ", "") in FUNCS else " " + m.group(2) + " ", s)
    s = re.sub(r"\\(operatorname|mathrm|mathop)\s*\{([^{}]*)\}", lambda m: " \\" + m.group(2).replace(" ", "") + " " if m.group(2).replace(" ", "") in FUNCS else " " + m.group(2).replace(" ", "") + " ", s)
    s = re.sub(r"\\(dfrac|tfrac|cfrac)", r"\\frac", s)
    s = re.sub(r"\\(mathfrak|bar)\s*\{?\s*d\s*\}?", r" \\dbar ", s)        # crossed d (inexact differential) has no single LaTeX spelling
    s = re.sub(r"\{\s*\\(cal|bf|rm|it)\s+([^{}]*)\}", r"\2", s)               # {\cal H} -> H
    s = re.sub(r"\\(" + STYLE + r")\s*\{([^{}]*)\}", r" \2 ", s)                  # style wrappers dropped
    s = re.sub(r"\\(" + STYLE + r")(?![A-Za-z])", " ", s)
    s = s.replace("\\bar", "\\overline")
    s = re.sub(r"\\(left|right)\s*\.", " ", s)
    s = re.sub(r"\\(left|right|bigl|bigr|Bigl|Bigr|biggl|biggr|big|Big|bigg|Bigg|displaystyle|limits|nolimits|smash|mathstrut)(?![A-Za-z])", " ", s)
    s = re.sub(r"\\(begin|end)\s*\{(array|aligned|align\*?|split|matrix|gathered|cases)\}(\s*\{[^{}]*\})?", " ", s)
    s = s.replace("&", " ")
    s = s.replace("\\\\", "§")                      # row break sentinel, before spacing commands are removed
    s = re.sub(r"\\(,|;|:|!|quad|qquad| )|~", " ", s)
    s = re.sub(r"\\(ldots|dots|cdots)(?![A-Za-z])", r" \\cdots ", s)
    s = s.replace("\\prime", "'").replace("{}", " ")
    s = re.sub(r"\^\s*\{?\s*'\s*\}?", "'", s)
    s = re.sub(r"§(\s*§)+", "§", s)
    for _ in range(4):
        s = re.sub(r"([_^])\s*\{\s*(\\[A-Za-z]+|[^{}\s])\s*\}", r"\1\2", s)
        s = re.sub(r"\{\s*\{([^{}]*)\}\s*\}", r"{\1}", s)
        s = re.sub(r"\{\s*(\\[A-Za-z]+|[^{}\s\\])\s*\}", r" \1 ", s)
        s = re.sub(r"\{\s*(\\[A-Za-z]+|[A-Za-z0-9])\s*\}(?=\s*[_^{}\\A-Za-z0-9(])", r"\1", s) if False else s
    s = re.sub(r"\\frac\s*(\d)\s*(\d)", r"\\frac{\1}{\2}", s)
    toks = [t for t in TOK.findall(s) if not t.isspace() and t not in "{}"]   # braces dropped: grouping is not compared
    while toks and toks[-1] == "§": toks.pop()
    while toks and toks[0] == "§": toks.pop(0)
    return toks

def exact(a, b, strip_text=False): return tokens(a, strip_text) == tokens(b, True)
def ned(a, b, strip_text=False):
    ta, tb = tokens(a, strip_text), tokens(b, True)
    if not ta and not tb: return 0.0
    return Levenshtein.distance(ta, tb) / max(len(ta), len(tb))

# ---- render equivalence via pdflatex + pdfium ----
PRE = r"\documentclass[border=2pt,varwidth=20cm]{standalone}\usepackage{amsmath,amssymb,mathtools}\begin{document}$\displaystyle\begin{aligned}%s\end{aligned}$\end{document}"
def _compile(tex, work):
    tex = clean(tex)
    d = work / hashlib.md5(tex.encode()).hexdigest(); d.mkdir(parents=True, exist_ok=True)
    pdf = d / "f.pdf"
    if not pdf.exists():
        (d / "f.tex").write_text(PRE % tex)
        r = subprocess.run(["pdflatex", "-interaction=nonstopmode", "-halt-on-error", "f.tex"], cwd=d, capture_output=True, timeout=60)
        if r.returncode != 0: return None
    return pdf if pdf.exists() else None

def render_many(texts, work):
    """pdflatex each formula (parallel), then rasterize sequentially (pdfium is not thread-safe); returns bitmap hash or None on compile failure."""
    import pypdfium2 as pdfium
    work = pathlib.Path(work); work.mkdir(parents=True, exist_ok=True)
    with cf.ThreadPoolExecutor(6) as ex:
        pdfs = list(ex.map(lambda t: _compile(t, work), texts))
    out = []
    for p in pdfs:
        if p is None: out.append(None); continue
        try:
            img = pdfium.PdfDocument(str(p))[0].render(scale=2).to_pil().convert("L")
            out.append(hashlib.md5(img.tobytes() + str(img.size).encode()).hexdigest())
        except Exception: out.append(None)
    return out
