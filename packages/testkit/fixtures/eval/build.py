"""
Builds eval/mini-set.json (an EvalSet over mini-corpus v1) and eval/retrievals.json (scripted ranked results per
question) from readable specs below. Chunk IDs come from mini-corpus/labels.json; gold text from the hand-derived
expected chunks; the set id from an independent implementation of core's evalSetId (sha256 of RFC 8785 JSON,
which for this ASCII-keyed data equals json.dumps(sort_keys, compact)). expected-metrics.json is written by hand
(see README.md); this script does not compute any metric.
Run: python3 -I build.py
"""
import base64, hashlib, json, pathlib

HERE = pathlib.Path(__file__).parent
MC = HERE.parent / "mini-corpus"
labels = json.loads((MC / "labels.json").read_text())
chunks = {c["label"]: c for d in json.loads((MC / "expected-chunks-v1.json").read_text()).values() for c in d}

def h(prefix, tag, parts):
    d = hashlib.sha256("\x1f".join([tag, *parts]).encode()).digest()
    return prefix + base64.b32encode(d).decode().lower().rstrip("=")[:20]
canon = lambda v: json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=False)

Q = [
    ("q1", "single-hop", "Why does halving the volume of a container of gas at fixed temperature double its pressure?",
     "Boyle's law: at constant temperature pressure is inversely proportional to volume.", ["gas/1-ab"], ["gas"]),
    ("q2", "single-hop", "What instrument reads the air pressure from the height of a liquid column?",
     "A mercury barometer (about 760 mm of mercury at sea level).", ["gas/1.1"], ["gas"]),
    ("q3", "multi-hop", "Which two corrections does the van der Waals equation make, and which velocity distribution explains the pressure of the ideal gas it corrects?",
     "Excluded volume b and intermolecular attraction a; the Maxwell distribution.", ["gas/1-cd", "gas/1-e"], ["gas"]),
    ("q4", "multi-hop", "How does entropy bound the efficiency of an engine, and which formula ties entropy to the count of microstates?",
     "Entropy taken from the hot reservoir cannot exceed entropy given to the cold one, so efficiency is at most 1 - Tc/Th; S = k log W.", ["entropy/3-a1", "entropy/2.1-d0"], ["entropy"]),
    ("q5", "topic", "What ground does the entropy chapter cover?",
     "The second law, the Boltzmann and Gibbs formulas, the third law and applications to engines and chemistry.", ["entropy/2", "entropy/2.1-x", "entropy/2.2-list"], ["entropy"]),
]
questions = []
for qid, typ, q, ref, gold, docs in Q:
    gold_ids = sorted(labels[g] for g in gold)
    by_id = {labels[g]: g for g in gold}
    questions.append({"id": qid, "type": typ, "question": q, "referenceAnswer": ref, "goldChunkIds": gold_ids,
                      "goldText": [chunks[by_id[i]]["text"] for i in gold_ids], "sourceDocKeys": docs})
set_id = h("qs_", "evalset/1", [canon(questions)])
(HERE / "mini-set.json").write_text(json.dumps({"id": set_id, "name": "mini-set", "genRecipeId": None, "questions": questions}, indent=1) + "\n")

REL = "rl_aaaaaaaaaaaaaaaaaaaa"   # a relation whose sources are A1 and X (stands in for the relation layer)
SUM = "sm_aaaaaaaaaaaaaaaaaaaa"   # a community summary over the entropy document
def chunk(label): return {"itemId": labels[label], "kind": "chunk", "sourceChunkIds": [labels[label]], "label": label}
R = {
    "q1": [chunk("gas/1-ab"), chunk("gas/1.1"), chunk("gas/pre"), chunk("gas/1-cd"), chunk("gas/1-e")],
    "q2": [chunk("gas/1-ab"), chunk("gas/1.2-p1"), chunk("gas/1.1"), chunk("gas/1-cd"), chunk("gas/pre")],
    "q3": [chunk("gas/1-cd"), chunk("gas/1-ab"), chunk("entropy/2"), chunk("gas/pre"), chunk("gas/1.1")],
    "q4": [{"itemId": REL, "kind": "relation", "sourceChunkIds": sorted([labels["entropy/3-a1"], labels["entropy/2.1-x"]]), "label": "relation(A1, X)"},
           chunk("entropy/2"), chunk("entropy/2.1-d1"), chunk("gas/1-e"), chunk("entropy/2.1-d0")],
    "q5": [{"itemId": SUM, "kind": "summary", "sourceChunkIds": sorted(labels[l] for l in ["entropy/2", "entropy/2.1-x", "entropy/2.2-list", "entropy/3-a2"]), "label": "summary(entropy doc)"},
           chunk("gas/1-ab"), chunk("entropy/2"), chunk("gas/1.1"), chunk("entropy/2.2-list")],
}
retrievals = {qid: [dict(it, rank=i + 1) for i, it in enumerate(items)] for qid, items in R.items()}
(HERE / "retrievals.json").write_text(json.dumps({"about": "Scripted retrieved condition per question: ranked items with kinds and source chunk IDs. See README.md.", "retrievals": retrievals}, indent=1) + "\n")
print("eval set", set_id)
