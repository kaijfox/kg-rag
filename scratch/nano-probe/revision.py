"""Probe nano-graphrag's handling of a revised decision. Deterministic fake LLM: isolates storage/merge behaviour."""
import asyncio, json, hashlib, shutil, os, numpy as np
from nano_graphrag import GraphRAG
from nano_graphrag._utils import wrap_embedding_func_with_attrs

calls = {"extract": 0, "report": 0, "other": 0}
SCRIPT = {  # chunk keyword -> extraction output
 "JSON files": '("entity"<|>STORE<|>DECISION<|>The store is JSON files (decided 2026-10-01).)##("entity"<|>JSON FILES<|>TECHNOLOGY<|>Flat files used for storage.)##("relationship"<|>STORE<|>JSON FILES<|>The store is implemented as JSON files.<|>8)<|COMPLETE|>',
 "better-sqlite3": '("entity"<|>STORE<|>TECHNOLOGY<|>The store is better-sqlite3, replacing JSON files (decided 2026-10-17).)##("entity"<|>BETTER-SQLITE3<|>TECHNOLOGY<|>Embedded SQL database.)##("relationship"<|>STORE<|>BETTER-SQLITE3<|>The store is implemented with better-sqlite3.<|>8)<|COMPLETE|>',
 "nothing relevant": '<|COMPLETE|>',
}
async def llm(prompt, system_prompt=None, history_messages=[], **kw):
    if "report" in prompt.lower() and "community" in prompt.lower():
        calls["report"] += 1
        return json.dumps({"title":"t","summary":"s","rating":5,"rating_explanation":"e","findings":[{"summary":"f","explanation":"x"}]})
    if history_messages == [] and "Real Data" in prompt:
        calls["extract"] += 1
        for k, v in sorted(SCRIPT.items(), key=lambda kv: kv[0] != "better-sqlite3"):
            if k in prompt.split("Real Data")[-1]: return v
        return '<|COMPLETE|>'
    calls["other"] += 1
    return "NO"

@wrap_embedding_func_with_attrs(embedding_dim=16, max_token_size=512)
async def emb(texts):
    return np.array([[b/255 for b in hashlib.sha256(t.encode()).digest()[:16]] for t in texts])

wd = "exp/wd"; shutil.rmtree(wd, ignore_errors=True)
g = GraphRAG(working_dir=wd, best_model_func=llm, cheap_model_func=llm, embedding_func=emb,
             entity_extract_max_gleaning=0, enable_llm_cache=False)

def show(tag):
    n = g.chunk_entity_relation_graph._graph
    print(f"--- {tag}")
    for name, d in n.nodes(data=True):
        if name.strip('"') == "STORE": print("  node STORE:", {k: d.get(k) for k in ("entity_type","description","source_id")})
    for u, v, d in n.edges(data=True):
        if "STORE" in (u, v): print("  edge", u, v, "weight", d.get("weight"), "desc", d.get("description"))
    rep = asyncio.run(g.community_reports.all_keys())
    print("  community reports stored:", len(rep), "| extract calls:", calls["extract"], "| report calls:", calls["report"])

g.insert("Decision 2026-10-01. The project store is JSON files on disk.")
show("after v1")
r0 = calls["report"]
g.insert("Decision 2026-10-17. The project store is better-sqlite3, replacing JSON files.")
show("after v2 (supersedes v1)")
print("  report calls spent on 2nd insert:", calls["report"] - r0)
# idempotence / failure path
before = asyncio.run(g.community_reports.all_keys())
g.insert("A note with nothing relevant in it.")
after = asyncio.run(g.community_reports.all_keys())
print(f"--- insert that extracts nothing: reports before={len(before)} after={len(after)}")
docs = asyncio.run(g.full_docs.all_keys())
print("  docs stored:", len(docs), "(3 inserted)")
