"""
Independent re-computation of search rankings over the mini-corpus for search/queries.json.

It re-implements, from their written definitions (not by running TypeScript):
  - HashEmbedder(4096): tokens = lowercase split on non-alphanumerics (the fixture text is ASCII), each token adds 1
    to component fnv1a32(utf8(token)) % 4096, then L2-normalize;
  - conditioning with HASH_SPACE: document = " > ".join(sectionPath) + "\n" + text, query = "question: " + query;
  - score = cosine similarity; order = score descending, then chunk ID ascending;
  - a build contains exactly the chunks of the documents' current versions (v1 or v2).
Chunks and IDs are read from mini-corpus/expected-chunks-v*.json and labels.json (hand-derived + oracle IDs).

Run: python3 -I oracle.py   -> prints the full ranking per query, the dominant shared tokens, and near-ties.
"""
import json, math, pathlib, re

HERE = pathlib.Path(__file__).parent
MC = HERE.parent / "mini-corpus"
labels = json.loads((MC / "labels.json").read_text())

def fnv1a32(s):
    h = 0x811C9DC5
    for b in s.encode("utf-8"):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h

def tokens(t):
    return [x for x in re.split(r"[^0-9a-z]+", t.lower()) if x]

def embed(t, dims=4096):
    v = [0.0] * dims
    for tok in tokens(t):
        v[fnv1a32(tok) % dims] += 1
    n = math.sqrt(sum(x * x for x in v))
    return [x / n for x in v] if n else v

def chunks(version):
    exp = json.loads((MC / f"expected-chunks-v{version}.json").read_text())
    return [dict(c, id=labels[c["label"]]) for d in ("entropy", "gas") for c in exp[d]]

def rank(query, version):
    q = embed("question: " + query)
    rows = []
    for c in chunks(version):
        d = embed(" > ".join(c["sectionPath"]) + "\n" + c["text"])
        rows.append((sum(a * b for a, b in zip(q, d)), c["id"], c["label"], c))
    rows.sort(key=lambda r: (-r[0], r[1]))
    return rows

if __name__ == "__main__":
    queries = json.loads((HERE / "queries.json").read_text())["queries"]
    for q in queries:
        rows = rank(q["query"], 1 if q["build"] == "v1" else 2)
        print(f"== {q['id']} [{q['build']}] {q['query']!r} k={q['k']}")
        qt = set(tokens(q["query"]))
        vocab = {t for v in (1, 2) for c in chunks(v) for t in tokens(" > ".join(c["sectionPath"]) + "\n" + c["text"])}
        coll = {t: sorted(o for o in vocab if o != t and fnv1a32(o) % 4096 == fnv1a32(t) % 4096) for t in qt}
        coll = {t: o for t, o in coll.items() if o}
        print("   bucket collisions of query tokens:", coll or "none")
        for s, cid, lab, c in rows[: max(5, len(q["expectedTop"]) + 2)]:
            doc_toks = tokens(" > ".join(c["sectionPath"]) + "\n" + c["text"])
            shared = {t: doc_toks.count(t) for t in qt if t in doc_toks}
            print(f"   {s:.6f} {lab:22} shared={shared}")
        gaps = [rows[i][0] - rows[i + 1][0] for i in range(min(len(rows) - 1, q["k"]))]
        near = [i + 1 for i, g in enumerate(gaps) if 0 < g < 1e-6]
        if near: print("   NEAR-TIE after ranks", near)
        got = [r[2] for r in rows[: len(q["expectedTop"])]]
        print("   oracle top:", got, "| fixture expects:", q["expectedTop"], "| MATCH" if got == q["expectedTop"] else "| MISMATCH")
        n = min(q["k"], len(rows))
        if n != q["expectedCount"]: print("   COUNT MISMATCH", n, q["expectedCount"])
        for bad in q.get("mustNotAppear", []):
            if bad in [r[2] for r in rows[:n]]: print("   MUST-NOT-APPEAR VIOLATED", bad)
