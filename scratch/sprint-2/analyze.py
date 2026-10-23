"""Compiles baseline tables from the run exports and rank files. Prints markdown."""
import json, os
from collections import defaultdict
A = ['kardar', 'plischke']
mean = lambda xs: round(sum(xs) / len(xs), 2) if xs else None
sets = {a: {q['id']: q for q in json.load(open(f'eval-set-{a}.json'))['questions']} for a in A}
ranks = {a: {r['id']: r for r in json.load(open(f'ranks-{a}.json'))} for a in A}
judge = defaultdict(dict)  # (author, qid) -> condition -> score
for a in A:
    for f, conds in ((f'run-own-{a}.json', ('no-context', 'gold')), (f'run-own-k5-{a}.json', ('retrieved',))):
        for r in json.load(open(f)).get('rows', []):
            if r['condition'] in conds: judge[(a, r['questionId'])][r['condition']] = r['judgeScore']
    p = f'run-cross-{"plischke" if a=="kardar" else "kardar"}-on-{a}.json'
    # cross file named by set author: cross-<setAuthor>-on-<indexAuthor>
for a in A:
    other = 'plischke' if a == 'kardar' else 'kardar'
    p = f'run-cross-{a}-on-{other}.json'
    if os.path.exists(p):
        for r in json.load(open(p))['rows']:
            judge[(a, r['questionId'])]['cross'] = r['judgeScore']

def table(title, groups):
    print(f'\n### {title}\n\n| group | n | no-context | gold | retrieved@5 | cross (answered from the other author) | gold - retrieved |\n|---|---|---|---|---|---|---|')
    for name, keys in groups:
        c = lambda cond: [judge[k][cond] for k in keys if cond in judge[k] and judge[k][cond] is not None]
        g, r = c('gold'), c('retrieved')
        print(f"| {name} | {len(keys)} | {mean(c('no-context'))} | {mean(g)} | {mean(r)} | {mean(c('cross'))} | {round(mean(g)-mean(r),2) if g and r else None} |")

keys = {a: [(a, q) for q in sets[a]] for a in A}
allk = keys['kardar'] + keys['plischke']
bytype = lambda ks, t: [k for k in ks if sets[k[0]][k[1]]['type'] == t]
formula = lambda k: any('[formula]' in t for t in sets[k[0]][k[1]]['goldText'])
table('Answer quality by author and type (judge mean, 0 to 1; the judge is conservative, see judge-validation/RESULT.md)',
      [('Kardar all', keys['kardar']), ('Plischke all', keys['plischke'])] +
      [(f'{a} {t}', bytype(keys[a], t)) for a in A for t in ('single-hop', 'multi-hop', 'topic')] +
      [(f'ALL {t}', bytype(allk, t)) for t in ('single-hop', 'multi-hop', 'topic')] +
      [('formula in gold', [k for k in allk if formula(k)]), ('no formula in gold', [k for k in allk if not formula(k)])])

print('\n### Retrieval (chunk recall of the gold, top-k of the full index; from ranks-*.json)\n\n| group | n | recall@1 | @3 | @5 | @10 | @20 | all-gold@5 | all-gold@20 |\n|---|---|---|---|---|---|---|---|---|')
def rrow(name, ks):
    rs = [ranks[a][q] for a, q in ks]
    if not rs: return
    f = lambda m, k: mean([r[m][str(k)] for r in rs])
    print(f"| {name} | {len(rs)} | {f('recall',1)} | {f('recall',3)} | {f('recall',5)} | {f('recall',10)} | {f('recall',20)} | {f('allGold',5)} | {f('allGold',20)} |")
for a in A: rrow(f'{a} all', keys[a])
for t in ('single-hop', 'multi-hop', 'topic'): rrow(f'ALL {t}', bytype(allk, t))
rrow('formula in gold', [k for k in allk if formula(k)]); rrow('no formula in gold', [k for k in allk if not formula(k)])

# evidence split across adjacent chunks: gold spans adjacent chunks
adj = [k for k in allk if ranks[k[0]][k[1]]['adjacent']]
print(f"\n### Evidence-split signature\n\nQuestions whose gold is several adjacent chunks: {len(adj)}.")
for k in adj:
    j = judge[k]; r = ranks[k[0]][k[1]]
    print(f"- {k[1]} ({sets[k[0]][k[1]]['type']}): gold judge {j.get('gold')}, retrieved judge {j.get('retrieved')}, all-gold@5 {r['allGold']['5']}, all-gold@20 {r['allGold']['20']}")
fail = [k for k in allk if judge[k].get('retrieved') is not None and judge[k].get('gold') is not None and judge[k]['retrieved'] < judge[k]['gold']]
print(f"\nQuestions where retrieved < gold (judge): {len(fail)} of {len(allk)}; of these, gold chunk not in top 5: {sum(1 for k in fail if ranks[k[0]][k[1]]['recall']['5'] < 1)}, adjacent-gold: {sum(1 for k in fail if ranks[k[0]][k[1]]['adjacent'])}")

# rank distribution of gold items (reranking pre-check)
print('\n### Rank distribution of gold chunks (single-hop, all authors)\n')
rk = [r for a, q in bytype(allk, 'single-hop') for r in ranks[a][q]['ranks']]
for lo, hi in ((1, 1), (2, 3), (4, 5), (6, 10), (11, 20), (21, 50)):
    print(f'- rank {lo}-{hi}: {sum(1 for r in rk if r is not None and lo <= r <= hi)} of {len(rk)}')
print(f'- not in top 50: {sum(1 for r in rk if r is None)}')
