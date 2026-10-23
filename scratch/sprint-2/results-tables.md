
### Answer quality by author and type (judge mean, 0 to 1; the judge is conservative, see judge-validation/RESULT.md)

| group | n | no-context | gold | retrieved@5 | cross (answered from the other author) | gold - retrieved |
|---|---|---|---|---|---|---|
| Kardar all | 37 | 0.8 | 0.93 | 0.91 | 0.24 | 0.02 |
| Plischke all | 26 | 0.73 | 1.0 | 0.9 | 0.31 | 0.1 |
| kardar single-hop | 20 | 0.82 | 0.97 | 0.93 | 0.38 | 0.04 |
| kardar multi-hop | 8 | 0.69 | 0.75 | 0.88 | 0.06 | -0.13 |
| kardar topic | 9 | 0.83 | 1.0 | 0.89 | 0.11 | 0.11 |
| plischke single-hop | 20 | 0.68 | 1.0 | 0.93 | 0.33 | 0.07 |
| plischke multi-hop | 4 | 1.0 | 1.0 | 0.88 | 0.25 | 0.12 |
| plischke topic | 2 | 0.75 | 1.0 | 0.75 | 0.25 | 0.25 |
| ALL single-hop | 40 | 0.75 | 0.99 | 0.93 | 0.35 | 0.06 |
| ALL multi-hop | 12 | 0.79 | 0.83 | 0.88 | 0.12 | -0.05 |
| ALL topic | 11 | 0.82 | 1.0 | 0.86 | 0.14 | 0.14 |
| formula in gold | 46 | 0.76 | 0.95 | 0.89 | 0.27 | 0.06 |
| no formula in gold | 17 | 0.79 | 1.0 | 0.94 | 0.26 | 0.06 |

### Retrieval (chunk recall of the gold, top-k of the full index; from ranks-*.json)

| group | n | recall@1 | @3 | @5 | @10 | @20 | all-gold@5 | all-gold@20 |
|---|---|---|---|---|---|---|---|---|
| kardar all | 37 | 0.57 | 0.89 | 0.94 | 0.94 | 0.94 | 0.84 | 0.84 |
| plischke all | 26 | 0.68 | 0.84 | 0.88 | 0.93 | 1.0 | 0.85 | 1.0 |
| ALL single-hop | 40 | 0.78 | 0.93 | 0.95 | 0.97 | 1.0 | 0.95 | 1.0 |
| ALL multi-hop | 12 | 0.42 | 0.89 | 0.96 | 0.96 | 1.0 | 0.92 | 1.0 |
| ALL topic | 11 | 0.26 | 0.63 | 0.73 | 0.78 | 0.81 | 0.36 | 0.45 |
| formula in gold | 46 | 0.59 | 0.85 | 0.91 | 0.94 | 0.96 | 0.83 | 0.89 |
| no formula in gold | 17 | 0.7 | 0.91 | 0.93 | 0.93 | 0.99 | 0.88 | 0.94 |

### Evidence-split signature

Questions whose gold is several adjacent chunks: 14.
- k25 (multi-hop): gold judge 0.5, retrieved judge 0.5, all-gold@5 1, all-gold@20 1
- k28 (topic): gold judge 1, retrieved judge 1, all-gold@5 0, all-gold@20 0
- k30 (topic): gold judge 1, retrieved judge 1, all-gold@5 1, all-gold@20 1
- k31 (topic): gold judge 1, retrieved judge 0.5, all-gold@5 0, all-gold@20 0
- k32 (topic): gold judge 1, retrieved judge 1, all-gold@5 1, all-gold@20 1
- kr212 (multi-hop): gold judge 1, retrieved judge 1, all-gold@5 1, all-gold@20 1
- kr214 (multi-hop): gold judge 0, retrieved judge 1, all-gold@5 1, all-gold@20 1
- kr225 (topic): gold judge 1, retrieved judge 1, all-gold@5 0, all-gold@20 0
- kr226 (topic): gold judge 1, retrieved judge 0.5, all-gold@5 0, all-gold@20 0
- kr228 (topic): gold judge 1, retrieved judge 1, all-gold@5 0, all-gold@20 0
- p24 (multi-hop): gold judge 1, retrieved judge 1, all-gold@5 1, all-gold@20 1
- p29 (topic): gold judge 1, retrieved judge 0.5, all-gold@5 1, all-gold@20 1
- p30 (topic): gold judge 1, retrieved judge 1, all-gold@5 0, all-gold@20 1
- pr222 (multi-hop): gold judge 1, retrieved judge 0.5, all-gold@5 0, all-gold@20 1

Questions where retrieved < gold (judge): 8 of 63; of these, gold chunk not in top 5: 4, adjacent-gold: 4

### Rank distribution of gold chunks (single-hop, all authors)

- rank 1-1: 31 of 40
- rank 2-3: 6 of 40
- rank 4-5: 1 of 40
- rank 6-10: 1 of 40
- rank 11-20: 1 of 40
- rank 21-50: 0 of 40
- not in top 50: 0
