"""
Builds the hand-made mini-corpus (two documents, v1 and v2) as DoclingDocument JSON inside kg parse-artifact
envelopes, plus the expected section-pack/1 output.

The expected output is NOT computed by running a chunker. The grouping of blocks into chunks below
(EXPECTED_*) was derived by hand from the section-pack/1 rules (see README.md for the arithmetic); this
script only (a) asserts that the block lengths satisfy the inequalities that derivation relies on and
(b) concatenates the hand-chosen block groups with "\n\n". Chunk IDs in labels.json come from an
independent Python implementation of core's chunkId formula (see golden/oracle.py), not from TypeScript.

Run: python3 build.py   (from this directory; stdlib only)
"""
import hashlib, base64, json, re, unicodedata, pathlib

HERE = pathlib.Path(__file__).parent

# ---------------------------------------------------------------- independent ID oracle (same formulas as core/ids.ts)
def norm_text(s):  # ASCII-only fixture text, so Python's \s and JS's \s agree here
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", s)).strip()

def hash_id(prefix, tag, parts):
    d = hashlib.sha256("\x1f".join([tag, *parts]).encode("utf-8")).digest()
    return prefix + base64.b32encode(d).decode().lower().rstrip("=")[:20]

def chunk_id(doc_key, section_path, text, occurrence):
    return hash_id("ch_", "chunk/1", [doc_key, "\x1e".join(norm_text(h) for h in section_path),
                                       hashlib.sha256(norm_text(text).encode()).hexdigest(), str(occurrence)])

# ---------------------------------------------------------------- block texts
T = {}
T["G_PRE"] = "These notes collect a few short facts about ideal gases for testing the chunker."
T["P1a"] = ("An ideal gas is a model in which the molecules are point particles that never interact except in "
            "brief elastic collisions. Its pressure, volume and temperature obey the ideal gas law, PV = NkT, "
            "where N is the number of molecules and k is the Boltzmann constant. The model works well for dilute "
            "gases far from condensation, such as helium or argon at room temperature and ordinary pressure, and "
            "it is the reference system against which real gases are compared in the rest of these notes here.")
T["P1b"] = ("Boyle observed that at constant temperature the pressure of a fixed amount of gas is inversely "
            "proportional to its volume: halving the volume of the container doubles the pressure. Charles found "
            "that at constant pressure the volume grows linearly with temperature. Both empirical laws are special "
            "cases of the ideal gas law and were historically the evidence that led to it, long before the "
            "molecular picture of a gas was accepted by chemists.")
T["P1c"] = "Real gases deviate from this simple behaviour at high density, where molecules are close together."
T["P1d"] = ("The van der Waals equation corrects the ideal gas law for two effects that the ideal model ignores. "
            "First, molecules occupy a finite excluded volume, so the volume available to each molecule is reduced "
            "by a constant b per mole. Second, molecules attract one another at moderate distances, which lowers "
            "the pressure exerted on the walls by an amount proportional to a over the square of the molar volume. "
            "The resulting equation of state predicts a critical point, below whose temperature the isotherms "
            "develop a loop that signals the coexistence of liquid and vapour. Maxwell's equal area construction "
            "replaces the loop by a flat segment at the vapour pressure. The van der Waals constants a and b are "
            "fitted to measured critical data for each substance, and the theory then gives a qualitative account "
            "of condensation, although the predicted critical compressibility ratio is not accurate for most real fluids.")
T["P1e"] = ("Kinetic theory explains the ideal gas law from the motion of molecules. In equilibrium the molecular "
            "speeds follow the Maxwell distribution, whose shape depends only on the temperature and the molecular "
            "mass. The mean kinetic energy per molecule is three halves of kT, independent of the mass, so heavier "
            "molecules move more slowly on average. The root mean square speed of nitrogen at room temperature is "
            "about five hundred metres per second. Collisions with the walls transfer momentum, and averaging that "
            "transfer over the Maxwell distribution recovers the pressure of the ideal gas law. Between collisions "
            "a molecule travels a mean free path that grows as the density falls, which sets the scale for "
            "viscosity, diffusion and thermal conduction in dilute gases. Effusion through a small hole, studied "
            "by Graham, selects faster molecules and was used to separate isotopes. All of these results follow "
            "from treating the molecules as independent classical particles with random velocities, the same "
            "assumptions that define the ideal gas.")
T["N"] = ("Avogadro proposed that equal volumes of different gases at the same temperature and pressure contain "
          "equal numbers of molecules. One mole of any ideal gas therefore occupies the same molar volume, and the "
          "number of molecules per mole is the Avogadro constant, about six times ten to the twenty three.")
T["P2a"] = ("Pressure is the momentum delivered per unit time and per unit area by molecules striking the walls of "
            "the container. Each impact reverses the normal component of a molecular velocity, and the rate of "
            "impacts grows with density and speed, so pressure grows with both.")
T["P2b"] = ("A mercury barometer measures atmospheric pressure by the height of a mercury column, about seven "
            "hundred sixty millimetres at sea level. The SI unit of pressure is the pascal, one newton per square "
            "metre, and one standard atmosphere is about one hundred kilopascals.")
T["C_T"] = "Table 1: Molar volume of gases at standard temperature and pressure."
GRID = [["Gas", "Molar volume", "Unit"], ["Helium", "22.4", "litre"], ["Argon", "22.4", "litre"]]
T["TABLE"] = T["C_T"] + "\n" + "\n".join(" | ".join(r) for r in GRID)

def sentence(i):
    s = f"Temperature remark {i:02d} compares the Celsius, Kelvin and Fahrenheit scales used in thermometry"
    filler = " and in laboratory practice with mercury and alcohol thermometers calibrated at fixed points"
    s = (s + filler)[:99]
    assert ". " not in s and len(s) == 99
    return s + "."
T["P3"] = " ".join(sentence(i) for i in range(1, 33))
T["P3_1"] = " ".join(sentence(i) for i in range(1, 15))
T["P3_2"] = " ".join(sentence(i) for i in range(15, 29))
T["P3_3"] = " ".join(sentence(i) for i in range(29, 33))
T["C_P"] = "Figure 1: A constant-volume gas thermometer."
T["PIC_LABEL1"] = "0 C"
T["PIC_LABEL2"] = "100 C"

T["S"] = "Entropy is a state function that counts, on a logarithmic scale, the microscopic arrangements of a system."
T["L"] = ("The second law of thermodynamics states that the entropy of an isolated system never decreases. For a "
          "reversible exchange of heat dQ at temperature T the entropy changes by dQ over T, while for an "
          "irreversible process the Clausius inequality gives a strictly larger entropy change than the heat "
          "exchanged divided by the temperature. Mixing two different gases, letting a gas expand freely into a "
          "vacuum, and conducting heat across a finite temperature difference are all irreversible and raise the "
          "total entropy. Because entropy is a state function, the change between two equilibrium states can be "
          "computed along any convenient reversible path, even when the actual process was irreversible. "
          "Equilibrium of an isolated system is reached when the entropy is as large as the constraints allow, "
          "and this maximum principle is the starting point for the stability conditions on heat capacities and "
          "compressibilities. In statistical mechanics the same quantity reappears as the logarithm of the "
          "number of accessible microstates, which connects the thermodynamic arrow of time to probability.")
T["D"] = ("Boltzmann's formula S = k log W relates the entropy to the number W of microstates compatible with the "
          "macroscopic state. It is engraved on his tombstone in Vienna and is the bridge between counting "
          "configurations and measuring heat.")
T["X"] = ("Gibbs generalized the counting to systems whose microstates have unequal probabilities: the entropy is "
          "minus k times the sum over states of p log p. For equal probabilities this reduces to Boltzmann's "
          "formula, and for a system in contact with a heat bath it yields the canonical entropy. Shannon later "
          "found the same expression as the measure of missing information in a message, so the information "
          "entropy of a source and the thermodynamic entropy of a gas share one mathematical form. The Gibbs "
          "expression is maximized, subject to fixed average energy, by the Boltzmann distribution, which is one "
          "way to derive the canonical ensemble without appealing to a heat bath. Maximum entropy inference uses "
          "the same idea for incomplete data in many other fields, such as image reconstruction and ecology, "
          "where only a few averages are known and every other assumption should be avoided.")
T["LI1"] = "Entropy approaches a constant value as the temperature approaches absolute zero."
T["LI2"] = "Heat capacities and thermal expansion coefficients vanish at absolute zero."
T["LI3"] = "Absolute zero cannot be reached in a finite number of cooling steps."
T["H"] = ("Residual entropies measured near zero kelvin in joules per mole kelvin for a list of samples: "
          + ", ".join(str(n) for n in range(1, 2000)))[:1600]
T["H_1"] = T["H"][:1500]
T["H_2"] = T["H"][1500:]
T["A1"] = ("Heat engines and refrigerators are governed by an entropy balance. An engine takes heat from a hot "
           "reservoir, rejects part of it to a cold reservoir and converts the difference into work; because the "
           "entropy taken from the hot side cannot exceed the entropy given to the cold side, the efficiency is "
           "at most one minus the ratio of the cold to the hot temperature, the Carnot efficiency. A refrigerator "
           "runs the cycle backwards and needs work to move heat from cold to hot. Real machines fall short of the "
           "Carnot limit because friction and finite temperature differences generate entropy.")
T["A1v2"] = T["A1"].replace("A refrigerator runs", "A heat pump runs")
T["A2"] = ("In chemistry the direction of a reaction at constant temperature and pressure is decided by the Gibbs "
           "free energy, G = H - TS. A reaction proceeds spontaneously when it lowers G, so a reaction that "
           "absorbs heat can still run if it increases the entropy enough, as when ice melts above zero degrees "
           "Celsius or salt dissolves in water and cools the solution. Entropy therefore decides chemical equilibrium as much as energy does.")

L = {k: len(v) for k, v in T.items()}

# ---------------------------------------------------------------- the inequalities the hand derivation uses (README.md)
TGT, MAX, MIN = 1000, 1500, 200
j = lambda *ks: sum(L[k] for k in ks) + 2 * (len(ks) - 1)
checks = {
    "P1a+P1b fits target": j("P1a", "P1b") <= TGT,
    "P1a+P1b+P1c exceeds target": j("P1a", "P1b", "P1c") > TGT,
    "P1c below minChars": L["P1c"] < MIN,
    "P1c+P1d fits maxChars": j("P1c", "P1d") <= MAX,
    "P1c+P1d exceeds target (so only the small-chunk rule allows it)": j("P1c", "P1d") > TGT,
    "P1c+P1d+P1e exceeds maxChars": j("P1c", "P1d", "P1e") > MAX,
    "P1e between target and maxChars": TGT < L["P1e"] <= MAX,
    "v2: N+P1a fits target": j("N", "P1a") <= TGT,
    "v2: N+P1a+P1b exceeds target": j("N", "P1a", "P1b") > TGT,
    "v2: N at least minChars": L["N"] >= MIN,
    "v2: P1b+P1c fits target": j("P1b", "P1c") <= TGT,
    "v2: P1b+P1c+P1d exceeds target": j("P1b", "P1c", "P1d") > TGT,
    "v2: P1d+P1e exceeds target": j("P1d", "P1e") > TGT,
    "1.1: P2a+[formula]+P2b+table fits target": L["P2a"] + 2 + 9 + 2 + L["P2b"] + 2 + L["TABLE"] <= TGT,
    "P3 is 32 sentences of 100 chars": L["P3"] == 32 * 100 + 31,
    "P3 pieces 1413/1413/403": (L["P3_1"], L["P3_2"], L["P3_3"]) == (1413, 1413, 403),
    "P3 pieces recompose P3": T["P3_1"] + " " + T["P3_2"] + " " + T["P3_3"] == T["P3"],
    "P3_3+caption fits target": j("P3_3", "C_P") <= TGT,
    "S below minChars": L["S"] < MIN,
    "S+L fits maxChars": j("S", "L") <= MAX,
    "S+L exceeds target": j("S", "L") > TGT,
    "L at most maxChars": L["L"] <= MAX,
    "D at least minChars": L["D"] >= MIN,
    "D+X exceeds target": j("D", "X") > TGT,
    "X at most target and >= minChars": MIN <= L["X"] <= TGT,
    "LI1..3 fit target": j("LI1", "LI2", "LI3") <= TGT,
    "LI block + H_1 exceeds maxChars": j("LI1", "LI2", "LI3", "H_1") > MAX,
    "H is 1600 chars with no sentence end": L["H"] == 1600 and re.search(r"\. [A-Z]", T["H"]) is None and "." not in T["H"],
    "H_2 is 100 chars": L["H_2"] == 100,
    "H_1+H_2 exceeds maxChars (no final merge)": j("H_1", "H_2") > MAX,
    "A1+A2 exceeds target": j("A1", "A2") > TGT,
    "A1v2+A2 exceeds target": j("A1v2", "A2") > TGT,
    "A1, A2 at least minChars": L["A1"] >= MIN and L["A2"] >= MIN and L["A1v2"] >= MIN,
    "no split inside blocks other than P3 and H": all(L[k] <= MAX for k in T if k not in ("P3", "H")),
    "no accidental sentence ends in P3 except between sentences": len(re.findall(r"\. [A-Z]", T["P3"])) == 31,
}
bad = [k for k, ok in checks.items() if not ok]
assert not bad, f"fixture inequalities violated: {bad}\nlengths: {L}"

# ---------------------------------------------------------------- DoclingDocument assembly
RECIPE = {"kind": "parse", "version": "1", "spec": {"parser": "docling", "doclingVersion": "2.140.0",
          "options": {"do_ocr": False, "do_table_structure": True, "do_formula_enrichment": False}}}

class Doc:
    def __init__(self, name):
        self.d = {"schema_name": "DoclingDocument", "version": "1.7.0", "name": name,
                  "origin": {"mimetype": "application/pdf", "binary_hash": 0, "filename": f"{name}.pdf"},
                  "furniture": {"self_ref": "#/furniture", "children": [], "content_layer": "furniture", "name": "_root_", "label": "unspecified"},
                  "body": {"self_ref": "#/body", "children": [], "content_layer": "body", "name": "_root_", "label": "unspecified"},
                  "groups": [], "texts": [], "pictures": [], "tables": [], "key_value_items": [], "form_items": [], "pages": {}}
        self.refs = {}
    def prov(self, pages, n):
        return [{"page_no": p, "bbox": {"l": 50.0, "t": 700.0, "r": 550.0, "b": 650.0, "coord_origin": "BOTTOMLEFT"}, "charspan": [0, n]} for p in pages]
    def page(self, p):
        self.d["pages"][str(p)] = {"size": {"width": 612.0, "height": 792.0}, "page_no": p}
    def text(self, key, label, pages, parent="#/body", layer="body", text=None, level=None, add_to=None):
        t = T[key] if text is None else text
        ref = f"#/texts/{len(self.d['texts'])}"
        item = {"self_ref": ref, "parent": {"$ref": parent}, "children": [], "content_layer": layer, "label": label,
                "prov": self.prov(pages, len(t)), "orig": t, "text": t}
        if level is not None: item["level"] = level
        if label == "formula": item["text"] = ""; item["orig"] = "fAClparenori x commaori y rparenori =0 (1.1)"
        self.d["texts"].append(item)
        for p in pages: self.page(p)
        (add_to if add_to is not None else self.d["body"]["children"]).append({"$ref": ref})
        self.refs[key] = ref
        return ref, item
    def group(self, label="list"):
        ref = f"#/groups/{len(self.d['groups'])}"
        g = {"self_ref": ref, "parent": {"$ref": "#/body"}, "children": [], "content_layer": "body", "name": label, "label": label}
        self.d["groups"].append(g); self.d["body"]["children"].append({"$ref": ref})
        return ref, g
    def table(self, key_caption, grid, pages):
        ref = f"#/tables/{len(self.d['tables'])}"
        cap_ref, _ = self.text(key_caption, "caption", pages, parent=ref, add_to=[])
        cells = [{"text": c, "row_span": 1, "col_span": 1, "start_row_offset_idx": r, "end_row_offset_idx": r + 1,
                  "start_col_offset_idx": ci, "end_col_offset_idx": ci + 1, "column_header": r == 0, "row_header": False,
                  "row_section": False, "fillable": False} for r, row in enumerate(grid) for ci, c in enumerate(row)]
        tab = {"self_ref": ref, "parent": {"$ref": "#/body"}, "children": [{"$ref": cap_ref}], "content_layer": "body",
               "label": "table", "prov": self.prov(pages, 0), "captions": [{"$ref": cap_ref}], "references": [], "footnotes": [],
               "data": {"table_cells": cells, "num_rows": len(grid), "num_cols": len(grid[0]),
                        "grid": [[{"text": c} for c in row] for row in grid]}, "annotations": []}
        self.d["tables"].append(tab); self.d["body"]["children"].append({"$ref": ref})
        self.refs["TABLE"] = ref
        return ref
    def picture(self, key_caption, label_keys, pages):
        ref = f"#/pictures/{len(self.d['pictures'])}"
        pic = {"self_ref": ref, "parent": {"$ref": "#/body"}, "children": [], "content_layer": "body", "label": "picture",
               "prov": self.prov(pages, 0), "captions": [], "references": [], "footnotes": [], "annotations": []}
        self.d["pictures"].append(pic); self.d["body"]["children"].append({"$ref": ref})
        for k in label_keys:
            r, _ = self.text(k, "text", pages, parent=ref, add_to=pic["children"])
        cap_ref, _ = self.text(key_caption, "caption", pages, parent=ref, add_to=pic["children"])
        pic["captions"].append({"$ref": cap_ref})
        self.refs["PIC"] = ref
        return ref

def build_gas(version):
    g = Doc("gas")
    g.text(None, "page_header", [1], layer="furniture", text="Lecture notes on gases")
    g.text("G_PRE", "text", [1])
    g.text(None, "section_header", [1], text="1 Ideal gases", level=1)
    if version == 2: g.text("N", "text", [1])
    g.text("P1a", "text", [1])
    g.text("P1b", "text", [1, 2])
    g.text(None, "page_header", [2], layer="furniture", text="1 Ideal gases")
    g.text("P1c", "text", [2])
    g.text("P1d", "text", [2])
    g.text("P1e", "text", [3])
    g.text(None, "section_header", [3], text="1.1 Pressure", level=2)
    g.text("P2a", "text", [3])
    g.text("F1", "formula", [3], text="")
    g.text("P2b", "text", [3])
    g.table("C_T", GRID, [4])
    g.text(None, "section_header", [4], text="1.2 Temperature", level=2)
    g.text("P3", "text", [4, 5])
    g.picture("C_P", ["PIC_LABEL1", "PIC_LABEL2"], [5])
    g.text(None, "page_footer", [5], layer="furniture", text="5")
    return g

def build_entropy(version):
    e = Doc("entropy")
    e.text(None, "title", [1], text="Entropy")
    e.text(None, "section_header", [1], text="2 Entropy", level=1)
    e.text("S", "text", [1])
    e.text("L", "text", [1])
    e.text(None, "section_header", [2], text="2.1 Definition", level=2)
    e.text("D", "text", [2]); e.refs["D#0"] = e.refs["D"]
    e.text("X", "text", [2])
    e.text("D", "text", [2]); e.refs["D#1"] = e.refs["D"]
    e.text(None, "section_header", [3], text="2.2 Third law", level=2)
    gref, grp = e.group("list")
    for k in ("LI1", "LI2", "LI3"):
        e.text(k, "list_item", [3], parent=gref, add_to=grp["children"])
    e.text("H", "text", [3])
    e.text(None, "page_footer", [3], layer="furniture", text="3")
    e.text(None, "section_header", [4], text="3 Applications", level=1)
    e.text("A1v2" if version == 2 else "A1", "text", [4]); e.refs["A1"] = e.refs.get("A1v2", e.refs.get("A1"))
    e.text("A2", "text", [4])
    return e

# ---------------------------------------------------------------- hand-derived expected chunks (README.md has the arithmetic)
# Each chunk: label, section path, blocks (keys of T, joined by "\n\n"), pages, refs (block keys whose self_refs it carries).
EXPECTED = {
    1: {
        "gas": [
            ("gas/pre", [], ["G_PRE"], [1], ["G_PRE"]),
            ("gas/1-ab", ["1 Ideal gases"], ["P1a", "P1b"], [1, 2], ["P1a", "P1b"]),
            ("gas/1-cd", ["1 Ideal gases"], ["P1c", "P1d"], [2], ["P1c", "P1d"]),
            ("gas/1-e", ["1 Ideal gases"], ["P1e"], [3], ["P1e"]),
            ("gas/1.1", ["1 Ideal gases", "1.1 Pressure"], ["P2a", "F1", "P2b", "TABLE"], [3, 4], ["P2a", "F1", "P2b", "TABLE", "C_T"]),
            ("gas/1.2-p1", ["1 Ideal gases", "1.2 Temperature"], ["P3_1"], [4, 5], ["P3"]),
            ("gas/1.2-p2", ["1 Ideal gases", "1.2 Temperature"], ["P3_2"], [4, 5], ["P3"]),
            ("gas/1.2-p3", ["1 Ideal gases", "1.2 Temperature"], ["P3_3", "C_P"], [4, 5], ["P3", "PIC", "C_P"]),
        ],
        "entropy": [
            ("entropy/2", ["Entropy", "2 Entropy"], ["S", "L"], [1], ["S", "L"]),
            ("entropy/2.1-d0", ["Entropy", "2 Entropy", "2.1 Definition"], ["D"], [2], ["D#0"]),
            ("entropy/2.1-x", ["Entropy", "2 Entropy", "2.1 Definition"], ["X"], [2], ["X"]),
            ("entropy/2.1-d1", ["Entropy", "2 Entropy", "2.1 Definition"], ["D"], [2], ["D#1"]),
            ("entropy/2.2-list", ["Entropy", "2 Entropy", "2.2 Third law"], ["LI1", "LI2", "LI3"], [3], ["LI1", "LI2", "LI3"]),
            ("entropy/2.2-h1", ["Entropy", "2 Entropy", "2.2 Third law"], ["H_1"], [3], ["H"]),
            ("entropy/2.2-h2", ["Entropy", "2 Entropy", "2.2 Third law"], ["H_2"], [3], ["H"]),
            ("entropy/3-a1", ["Entropy", "3 Applications"], ["A1"], [4], ["A1"]),
            ("entropy/3-a2", ["Entropy", "3 Applications"], ["A2"], [4], ["A2"]),
        ],
    },
}
EXPECTED[2] = {
    "gas": [
        EXPECTED[1]["gas"][0],
        ("gas/v2/1-na", ["1 Ideal gases"], ["N", "P1a"], [1], ["N", "P1a"]),
        ("gas/v2/1-bc", ["1 Ideal gases"], ["P1b", "P1c"], [1, 2], ["P1b", "P1c"]),
        ("gas/v2/1-d", ["1 Ideal gases"], ["P1d"], [2], ["P1d"]),
        *EXPECTED[1]["gas"][3:],
    ],
    "entropy": [
        *EXPECTED[1]["entropy"][:7],
        ("entropy/v2/3-a1", ["Entropy", "3 Applications"], ["A1v2"], [4], ["A1"]),
        EXPECTED[1]["entropy"][8],
    ],
}
# Hand-derived diff: which v1 chunks survive in v2 (same ID), which vanish, which are new.
DIFF = {
    "survive": ["gas/pre", "gas/1-e", "gas/1.1", "gas/1.2-p1", "gas/1.2-p2", "gas/1.2-p3",
                "entropy/2", "entropy/2.1-d0", "entropy/2.1-x", "entropy/2.1-d1", "entropy/2.2-list",
                "entropy/2.2-h1", "entropy/2.2-h2", "entropy/3-a2"],
    "vanish": ["gas/1-ab", "gas/1-cd", "entropy/3-a1"],
    "new": ["gas/v2/1-na", "gas/v2/1-bc", "gas/v2/1-d", "entropy/v2/3-a1"],
}

def envelope(doc, version):
    name = doc.d["name"]
    return {"format": "kg-parse-artifact/1",
            "sourceSha256": hashlib.sha256(f"mini-corpus/{name}/v{version}".encode()).hexdigest(),
            "sourceName": f"{name}.pdf", "recipe": RECIPE, "parser": {"name": "docling", "version": "2.140.0"},
            "producedAt": "2026-10-17T12:00:00Z", "producedOn": "hand-built",
            "stats": {"pages": len(doc.d["pages"]), "chars": sum(len(t["text"]) for t in doc.d["texts"]), "charsPerPage": [],
                      "undecodedFormulas": sum(1 for t in doc.d["texts"] if t["label"] == "formula"), "elapsedMs": 0},
            "document": doc.d}

labels = {}
for version in (1, 2):
    docs = {"gas": build_gas(version), "entropy": build_entropy(version)}
    expected = {}
    for name, doc in docs.items():
        (HERE / f"v{version}" / f"{name}.kgparse.json").write_text(json.dumps(envelope(doc, version), indent=1) + "\n")
        out, seen = [], {}
        for label, path, blocks, pages, refkeys in EXPECTED[version][name]:
            text = "\n\n".join("[formula]" if b == "F1" else T[b] for b in blocks)
            key = ("\x1e".join(path), norm_text(text)); occ = seen.get(key, 0); seen[key] = occ + 1
            refs = []
            for k in refkeys:
                r = doc.refs[k]
                if r not in refs: refs.append(r)
            cid = chunk_id(name, path, text, occ)
            if label in labels: assert labels[label] == cid, label
            labels[label] = cid
            out.append({"label": label, "sectionPath": path, "blocks": blocks, "occurrence": occ, "pages": pages, "blockRefs": refs,
                        "chars": len(text), "text": text})
        expected[name] = out
    (HERE / f"expected-chunks-v{version}.json").write_text(json.dumps(expected, indent=1) + "\n")

# ---------------------------------------------------------------- extra: identical paragraph in two sections
# Paragraph D (233 chars) is the only block of section "A Gases" and of section "B Liquids". Same text, different
# section path: occurrence is counted per (section, text), so both are occurrence 0 and their IDs differ only by
# the path (a chunker counting occurrences across sections gives the second one occurrence 1: review mutant M03).
(HERE / "extra").mkdir(exist_ok=True)
x = Doc("dupsec")
x.text(None, "section_header", [1], text="A Gases", level=1)
x.text("D", "text", [1]); x.refs["D#a"] = x.refs["D"]
x.text(None, "section_header", [1], text="B Liquids", level=1)
x.text("D", "text", [1]); x.refs["D#b"] = x.refs["D"]
env = envelope(x, 1); env["sourceSha256"] = hashlib.sha256(b"mini-corpus/dupsec/v1").hexdigest()
(HERE / "extra" / "dupsec.kgparse.json").write_text(json.dumps(env, indent=1) + "\n")
dup = []
for label, path, ref in (("dupsec/a", ["A Gases"], "D#a"), ("dupsec/b", ["B Liquids"], "D#b")):
    cid = chunk_id("dupsec", path, T["D"], 0); labels[label] = cid
    dup.append({"label": label, "sectionPath": path, "blocks": ["D"], "occurrence": 0, "pages": [1], "blockRefs": [x.refs[ref]], "chars": L["D"], "text": T["D"]})
assert dup[0]["text"] == dup[1]["text"] and labels["dupsec/a"] != labels["dupsec/b"]
(HERE / "extra" / "expected-chunks.json").write_text(json.dumps({"dupsec": dup}, indent=1) + "\n")

v1 = {c["label"] for d in EXPECTED[1].values() for c in [dict(label=x[0]) for x in d]}
v2 = {c["label"] for d in EXPECTED[2].values() for c in [dict(label=x[0]) for x in d]}
assert set(DIFF["survive"]) == v1 & v2 and set(DIFF["vanish"]) == v1 - v2 and set(DIFF["new"]) == v2 - v1
(HERE / "expected-diff.json").write_text(json.dumps(DIFF, indent=1) + "\n")
(HERE / "labels.json").write_text(json.dumps(labels, indent=1, sort_keys=True) + "\n")
print("block lengths:", {k: v for k, v in L.items() if k not in ("P3_1", "P3_2", "P3_3", "H_1", "H_2")})
print("chunks v1:", sum(len(v) for v in EXPECTED[1].values()), "v2:", sum(len(v) for v in EXPECTED[2].values()))
