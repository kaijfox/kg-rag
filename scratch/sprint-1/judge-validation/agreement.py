#!/usr/bin/env python3
"""Agreement between the judge and the agent scorer. Input: JSONL rows {id, condition, type, judge, ref} with scores in {0, 0.5, 1}.
Usage: python3 agreement.py scored.jsonl   (prints exact agreement, quadratic-weighted kappa with a bootstrap CI, confusion matrix, bias per condition)"""
import json, random, sys
from collections import Counter, defaultdict
LV = [0, 0.5, 1]
rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]

def kappa(pairs):
    n = len(pairs)
    obs = Counter(pairs)
    a = Counter(p[0] for p in pairs); b = Counter(p[1] for p in pairs)
    w = lambda i, j: ((LV.index(i) - LV.index(j)) / 2) ** 2
    num = sum(w(i, j) * obs[(i, j)] / n for i in LV for j in LV)
    den = sum(w(i, j) * (a[i] / n) * (b[j] / n) for i in LV for j in LV)
    return 1.0 if den == 0 and num == 0 else (1 - num / den if den else float('nan'))

pairs = [(r['judge'], r['ref']) for r in rows]
print(f"n={len(rows)}  exact agreement={sum(j == r for j, r in pairs) / len(rows):.2f}  weighted kappa={kappa(pairs):.2f}")
random.seed(0)
ks = sorted(k for k in (kappa([random.choice(pairs) for _ in pairs]) for _ in range(2000)) if k == k)
print(f"bootstrap 95% CI for kappa: {ks[int(.025 * len(ks))]:.2f} .. {ks[int(.975 * len(ks))]:.2f}")
print("confusion (rows=ref, cols=judge):  " + "  ".join(f"j={j}" for j in LV))
for r in LV: print(f"ref={r:<4}", *[sum(1 for p in pairs if p == (j, r)) for j in LV])
by = defaultdict(list)
for r in rows: by[r['condition']].append(r['judge'] - r['ref'])
for c, d in by.items(): print(f"bias {c}: mean(judge-ref)={sum(d) / len(d):+.2f} (n={len(d)})")
print("judge >0 where ref=0:", [r['id'] for r in rows if r['ref'] == 0 and r['judge'] > 0])
print("judge=1 where ref<=0.5:", [r['id'] for r in rows if r['judge'] == 1 and r['ref'] <= 0.5])
