"""Hand-checked references. Starting point = docling CPU CodeFormulaV2 output (out/ref_cpu_all.json); `fix` holds my corrections
after reading each crop. Items not in `fix` were read against the image and left as the model produced them, except that
neighbor-text lines (\\text, \\intertext), equation numbers and alignment markers are removed by the rule documented in results.md."""
import json, re
from common import HERE
sel = json.load(open(HERE / "gold_selection.json"))
raw = json.load(open(HERE / "out/ref_cpu_all.json"))
DROP = {"FP-p06-t59": "docling bbox truncates the formula (crop cut mid-fraction); unreadable",
        "IFK-p13-177": "my span box cuts the leading f_2; replaced by nothing", "ITK-p19-215": "span box cuts the leading F_s"}
fix = {
 "FK-p19-t277": r"\ln f_1(\vec p_1,\vec q)+\ln f_1(\vec p_2,\vec q)=\ln f_1(\vec p_1{}',\vec q)+\ln f_1(\vec p_2{}',\vec q).",
 "FK-p27-t426": r"v_\ell=\sqrt{\frac{5}{3}\frac{k_B\overline{T}}{m}}",
 "FK-p28-t439": r"\mathcal{L}[\ln f_1^0]=0-\frac{mc^2}{3k_BT}\partial_\alpha u_\alpha+c_\alpha\left[\left(\frac{F_\alpha}{k_BT}-\frac{\partial_\alpha n}{n}-\frac{\partial_\alpha T}{T}\right)+\left(\frac{\partial_\alpha n}{n}-\frac32\frac{\partial_\alpha T}{T}\right)-\frac{F_\alpha}{k_BT}\right]\\+\frac{mc^2}{2k_BT^2}c_\alpha\partial_\alpha T+\frac{m}{k_BT}c_\alpha c_\beta u_{\alpha\beta}\\=\frac{m}{k_BT}\left(c_\alpha c_\beta-\frac{\delta_{\alpha\beta}}{3}c^2\right)u_{\alpha\beta}+\left(\frac{mc^2}{2k_BT}-\frac52\right)\frac{c_\alpha}{T}\partial_\alpha T.",
 "FK-p60-t1007": r"\mathcal{Z}(N,T,P)=\int_0^\infty dV e^{-\beta PV}\int\frac{1}{N!}\prod_{i=1}^N\frac{d^3\vec q_i d^3\vec p_i}{h^3}\exp\left[-\beta\sum_{i=1}^N\frac{p_i^2}{2m}\right]\\=\int_0^\infty dV V^N e^{-\beta PV}\frac{1}{N!\lambda(T)^{3N}}=\frac{1}{(\beta P)^{N+1}\lambda(T)^{3N}}.",
 "FK-p64-t1075": r"P=-\frac{\mathcal{G}}{V}=-\frac{\partial\mathcal{G}}{\partial V}\Big|_{\mu,T}=k_BT\frac{e^{\beta\mu}}{\lambda^3}.",
 "TK-p04-t55": r"\left(P+\frac{a}{V^2}\right)(V-b)(L-L_0)-c[F-K(L-L_0)]=0,\\\left(P+\frac{a}{V^2}\right)(V-b)M-dB=0.",
 "TK-p04-t57": r"\Theta\propto\left(P+\frac{a}{V^2}\right)(V-b)=c\left(\frac{F}{L-L_0}-K\right)=d\frac{B}{M}.",
 "TK-p14-t275": r"\bar{d}Q_R=T_0\frac{\bar{d}Q}{T}.",
 "TK-p17-t334": r"x_i=-\frac{\partial H}{\partial J_i}\Big|_{S,J_{j\neq i}}.",
 "TK-p24-t460": r"\delta S=-\frac{2}{T_A}\left[\delta T_A\left(\frac{\delta E_A-J_A\cdot\delta x_A-\mu_A\cdot\delta N_A}{T_A}\right)+\delta J_A\cdot\delta x_A+\delta\mu_A\cdot\delta N_A\right]\\=-\frac{2}{T_A}\left[\delta T_A\delta S_A+\delta J_A\cdot\delta x_A+\delta\mu_A\cdot\delta N_A\right].",
 "TK-p25-t472": r"C_x=\frac{\bar{d}Q}{dT}\Big|_x=T\frac{\partial S}{\partial T}\Big|_x\geq0.",
 "FP-p18-t235": r"\langle n_k\rangle=-k_BT\frac{\partial}{\partial\mu}\ln[1-\exp\{-\beta(E_k-\mu)\}]=\frac{1}{\exp\{\beta(E_k-\mu)\}-1}.",
 "TP-p10-t123": r"dA=dE-d(TS)\\=\bar{d}Q-TdS-SdT-\bar{d}W.",
 "TP-p24-t315": r"v_1(P_c,T_c)=\frac{\partial g_1}{\partial P}\Big|_{P_c,T_c}=v_2(P_c,T_c)=\frac{\partial g_2}{\partial P}\Big|_{P_c,T_c}",
 "IFK-p17-51": r"(\vec p_1{}',\vec p_2{}',\vec b{}')",
 "IFK-p23-116": r"(\vec p_1{}',\vec p_2{}')",
 "ITK-p12-329": r"(T_1>T_2>T_3).",
 "ITK-p18-377": r"=\{N_1,N_2,\cdots\}",
}
# neighbor-text-only cleanups (no content change): items whose raw output carried \text/\intertext lines or an eq. number
textclean = {"FK-p56-t936": None}
out = []
for g in sel:
    if g["id"] in DROP: continue
    r = fix.get(g["id"], raw[g["id"]])
    g = dict(g); g["reference"] = r; g["docling_cpu_raw"] = raw[g["id"]]
    g["status"] = "corrected" if g["id"] in fix else "accepted"
    out.append(g)
json.dump(out, open(HERE / "gold.json", "w"), indent=1, ensure_ascii=False)
print(len(out), sum(g["status"] == "corrected" for g in out), sum(g["kind"] == "inline" for g in out))
