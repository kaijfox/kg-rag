"""
Independent oracle for packages/testkit/golden/ids.json.

Hand-written (by reading the formulas in core/src/ids.ts, not by running TypeScript):
  - every expected canonical JSON string, normText and normName output below;
  - base32 vectors are the RFC 4648 section 10 test vectors (lowercased, unpadded).
Computed here, with Python's hashlib (not the TypeScript under test):
  - every ID, as prefix + base32(sha256(tag U+001F part1 U+001F ...))[:20], from the hand-written canonical
    strings and hand-normalized texts.

Run: python3 -I oracle.py > ids.json
"""
import base64, hashlib, json

def h(prefix, tag, parts):
    d = hashlib.sha256("\x1f".join([tag, *parts]).encode("utf-8")).digest()
    return prefix + base64.b32encode(d).decode().lower().rstrip("=")[:20]
sha = lambda s: hashlib.sha256(s.encode("utf-8")).hexdigest()

canonical = [
    {"input": {"b": 1, "a": 2}, "expected": '{"a":2,"b":1}'},
    {"input": {"z": [3, {"y": None, "x": True}], "a": "s"}, "expected": '{"a":"s","z":[3,{"x":true,"y":null}]}'},
    {"input": [1.0, 0.5, -0.0, 1e21, 1e-7, 100, 123456789012, 0.30000000000000004], "expected": "[1,0.5,0,1e+21,1e-7,100,123456789012,0.30000000000000004]"},
    {"input": "a\"b\\c\n\u0001 é", "expected": "\"a\\\"b\\\\c\\n\\u0001 é\""},
    {"input": {"é": 1, "z": 2, "\U0001F600": 3, "｡": 4}, "expected": '{"z":2,"é":1,"\U0001F600":3,"｡":4}', "why": "keys sort by UTF-16 code units: U+1F600 (D83D DE00) sorts before U+FF61"},
    {"input": {}, "expected": "{}"},
    {"input": [], "expected": "[]"},
    {"input": "", "expected": '""'},
    {"input": {"a": {}, "b": [], "c": False}, "expected": '{"a":{},"b":[],"c":false}'},
]

norm_text = [
    {"input": "  a  b\r\n\tc  ", "expected": "a b c"},
    {"input": "ﬁeld", "expected": "ﬁeld", "why": "ligature kept: NFC, not NFKC"},
    {"input": "café", "expected": "café", "why": "NFC composes"},
    {"input": "x　 y", "expected": "x y"},
    {"input": "line1\r\nline2", "expected": "line1 line2"},
    {"input": "zero​width", "expected": "zero​width", "why": "U+200B is not whitespace in JS \\s"},
]

norm_name = [
    {"input": "Dorsolateral Striatum (DLS).", "expected": "dorsolateral striatum (dls)"},
    {"input": "  \"Entropy\"  ", "expected": "entropy"},
    {"input": "ﬁeld", "expected": "field", "why": "NFKC expands the ligature"},
    {"input": "C++", "expected": "c++", "why": "+ is a symbol, not punctuation"},
    {"input": "...(rat)", "expected": "(rat)", "why": "opening bracket kept"},
    {"input": "ΔS", "expected": "δs"},
    {"input": "Ｈｅｌｌｏ", "expected": "hello", "why": "fullwidth folded by NFKC"},
]

base32 = [
    {"input": "", "expected": ""}, {"input": "f", "expected": "my"}, {"input": "fo", "expected": "mzxq"},
    {"input": "foo", "expected": "mzxw6"}, {"input": "foob", "expected": "mzxw6yq"},
    {"input": "fooba", "expected": "mzxw6ytb"}, {"input": "foobar", "expected": "mzxw6ytboi"},
]

PATH = "1 Ideal gases\x1e1.1 Pressure"
chunk = [
    {"docKey": "gas", "sectionPath": [], "text": "Hello world.", "occurrence": 0,
     "id": h("ch_", "chunk/1", ["gas", "", sha("Hello world."), "0"])},
    {"docKey": "gas", "sectionPath": ["1 Ideal gases", "1.1 Pressure"], "text": "Pressure is force per area.", "occurrence": 0,
     "id": h("ch_", "chunk/1", ["gas", PATH, sha("Pressure is force per area."), "0"])},
    {"docKey": "gas", "sectionPath": ["1 Ideal gases", "1.1 Pressure"], "text": "Pressure is force per area.", "occurrence": 1,
     "id": h("ch_", "chunk/1", ["gas", PATH, sha("Pressure is force per area."), "1"])},
    {"docKey": "gas", "sectionPath": ["1 Ideal gases", "1.1 Pressure"], "text": "Pressure  is force per\narea. ", "occurrence": 0,
     "id": h("ch_", "chunk/1", ["gas", PATH, sha("Pressure is force per area."), "0"]), "why": "same ID as the second vector: whitespace normalized"},
    {"docKey": "gas", "sectionPath": ["1  Ideal gases", " 1.1 Pressure"], "text": "Pressure is force per area.", "occurrence": 0,
     "id": h("ch_", "chunk/1", ["gas", PATH, sha("Pressure is force per area."), "0"]), "why": "headings normalized too"},
    {"docKey": "entropy", "sectionPath": ["Entropy"], "text": "ﬁnite café", "occurrence": 0,
     "id": h("ch_", "chunk/1", ["entropy", "Entropy", sha("ﬁnite café"), "0"])},
    {"docKey": "kardar", "sectionPath": ["1 Ideal gases", "1.1 Pressure"], "text": "Pressure is force per area.", "occurrence": 0,
     "id": h("ch_", "chunk/1", ["kardar", PATH, sha("Pressure is force per area."), "0"]), "why": "docKey is part of the ID"},
]

PARSE = '{"kind":"parse","spec":{"doclingVersion":"2.140.0","options":{"do_formula_enrichment":false,"do_ocr":false,"do_table_structure":true},"parser":"docling"},"version":"1"}'
CHUNK = '{"kind":"chunk","spec":{"algorithm":"section-pack/1","maxChars":1500,"minChars":200,"targetChars":1000},"version":"1"}'
SEARCH = '{"kind":"search","spec":{"steps":[{"params":{"kinds":["chunk"],"pool":100},"type":"vector-knn"},{"params":{},"type":"truncate"}]},"version":"1"}'
SPACE = '{"dims":768,"documentTemplate":"title: {headings} | text: {text}","model":"embeddinggemma:latest","queryTemplate":"task: search result | query: {query}"}'
recipes = [
    {"name": "DEFAULT_PARSE_RECIPE", "canonical": PARSE, "id": h("rc_", "recipe/1", [PARSE])},
    {"name": "DEFAULT_CHUNK_RECIPE", "canonical": CHUNK, "id": h("rc_", "recipe/1", [CHUNK])},
    {"name": "DEFAULT_SEARCH_RECIPE", "canonical": SEARCH, "id": h("rc_", "recipe/1", [SEARCH])},
]
space = {"name": "DEFAULT_SPACE", "canonical": SPACE, "id": h("es_", "space/1", [SPACE])}

ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"  # sha256("abc"), FIPS 180-2 test vector
assert sha("abc") == ABC
art = h("pa_", "artifact/1", [ABC, recipes[0]["id"]])
dv = h("dv_", "docversion/1", ["gas", art, recipes[1]["id"]])

MANIFEST_IN = {"docVersions": {"gas": "dv_aaaaaaaaaaaaaaaaaaaa", "entropy": "dv_bbbbbbbbbbbbbbbbbbbb"},
               "embeddingSpaces": ["es_cccccccccccccccccccc"], "searchRecipeId": "rc_dddddddddddddddddddd",
               "derivedRecipes": [], "mappingRuns": [], "mixedRecipes": False}
ITEMS_IN = ["ch_bbbbbbbbbbbbbbbbbbbb", "ch_aaaaaaaaaaaaaaaaaaaa", "ch_bbbbbbbbbbbbbbbbbbbb"]
MANIFEST = '{"derivedRecipes":[],"docVersions":{"entropy":"dv_bbbbbbbbbbbbbbbbbbbb","gas":"dv_aaaaaaaaaaaaaaaaaaaa"},"embeddingSpaces":["es_cccccccccccccccccccc"],"mappingRuns":[],"mixedRecipes":false,"searchRecipeId":"rc_dddddddddddddddddddd"}'

out = {
    "about": "Golden vectors for core/src/ids.ts. See README.md: expected strings are hand-written; IDs come from golden/oracle.py (Python hashlib), never from the TypeScript under test.",
    "canonicalJson": canonical,
    "canonicalJsonErrors": ["NaN", "Infinity", "lone surrogate \\ud800"],
    "normText": norm_text,
    "normName": norm_name,
    "base32": base32,
    "chunkId": chunk,
    "recipeId": recipes,
    "spaceId": space,
    "nodeId": [{"name": "Dorsolateral Striatum (DLS).", "normalized": "dorsolateral striatum (dls)", "id": h("nd_", "node/1", ["dorsolateral striatum (dls)"])},
               {"name": "dorsolateral  striatum (DLS)", "normalized": "dorsolateral striatum (dls)", "id": h("nd_", "node/1", ["dorsolateral striatum (dls)"]), "why": "same node"}],
    "artifactId": {"sourceSha256": ABC, "parseRecipe": recipes[0]["id"], "id": art},
    "docVersionId": {"docKey": "gas", "artifactId": art, "chunkRecipe": recipes[1]["id"], "id": dv},
    "buildId": {"manifest": MANIFEST_IN, "canonical": MANIFEST, "itemIds": ITEMS_IN, "id": h("bd_", "build/2", [MANIFEST, ",".join(sorted(set(ITEMS_IN)))]),
                "why": "build/2 (R-23): item IDs are hashed too; input order and duplicates do not matter"},
}
print(json.dumps(out, indent=1, ensure_ascii=False))
