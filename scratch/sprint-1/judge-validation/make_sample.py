"""Builds the 30-row judge-validation sample from the Sprint 2 own-corpus runs (seed 17).

Writes, next to this file's sprint-2 counterpart (scratch/sprint-2/judge-validation/):
  sample.jsonl  id, question, referenceAnswer, answer          (what the scorer sees; no condition, no judge fields)
  key.jsonl     id, condition, type, author, judge, judgeRaw    (what the scorer must not see)
Selection: 10 rows per condition (no-context, gold, retrieved), spread over the judge's own scores 0 / 0.5 / 1 as evenly as
the data allows (round robin over the score buckets), types mixed. Rows whose answer contains "own knowledge" or "Score:" are
forced in first. The judge score is used to choose rows only; the scorer never sees it.
"""
import json, os, random, sys

root = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..'))
s2 = os.path.join(root, 'scratch/sprint-2')
out = os.path.join(s2, 'judge-validation')
os.makedirs(out, exist_ok=True)
rnd = random.Random(17)

sets = {a: {q['id']: q for q in json.load(open(f'{s2}/eval-set-{a}.json'))['questions']} for a in ('kardar', 'plischke')}
rows = []
for a in ('kardar', 'plischke'):
    for f, conds in ((f'run-own-{a}.json', ('no-context', 'gold')), (f'run-own-k5-{a}.json', ('retrieved',))):
        p = os.path.join(s2, f)
        if not os.path.exists(p):
            sys.exit(f'missing {p}')
        for r in json.load(open(p))['rows']:
            if r['condition'] in conds and r['answer'] and r['judgeScore'] is not None:
                q = sets[a][r['questionId']]
                rows.append(dict(id=f"{a}/{r['questionId']}/{r['condition']}", author=a, condition=r['condition'], type=q['type'],
                                 question=q['question'], referenceAnswer=q['referenceAnswer'], answer=r['answer'],
                                 judge=r['judgeScore'], judgeRaw=r['judgeRaw']))

chosen = []
for cond in ('no-context', 'gold', 'retrieved'):
    pool = [r for r in rows if r['condition'] == cond]
    rnd.shuffle(pool)
    forced = [r for r in pool if 'own knowledge' in r['answer'].lower() or 'Score:' in r['answer']][:3]
    take = list(forced)
    buckets = {s: [r for r in pool if r['judge'] == s and r not in take] for s in (0, 0.5, 1)}
    while len(take) < 10 and any(buckets.values()):
        for s in (0, 0.5, 1):
            if buckets[s] and len(take) < 10:
                take.append(buckets[s].pop())
    chosen += take
rnd.shuffle(chosen)
with open(f'{out}/sample.jsonl', 'w') as f, open(f'{out}/key.jsonl', 'w') as k:
    for r in chosen:
        f.write(json.dumps({x: r[x] for x in ('id', 'question', 'referenceAnswer', 'answer')}) + '\n')
        k.write(json.dumps({x: r[x] for x in ('id', 'condition', 'type', 'author', 'judge', 'judgeRaw')}) + '\n')
from collections import Counter
print(len(chosen), Counter((r['condition'], r['judge']) for r in chosen))
