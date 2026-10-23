# Relation-extractor pilot: evaluation

Data: 12 chunks per author (Kardar 96 relations, Plischke 89). Judged by hand, strictly; details in evaluation.json. N is tiny, so all rates are rough (one item = 8 points of coverage, 5 points of sample quality).

## 1. Coverage (a relation states the fact the reference answer needs)
| Author | Covered / total | Not covered |
|---|---|---|
| Kardar | 10 / 12 | K1 wrong/vague; K4 fact split across 3 relations + undecoded formula |
| Plischke | 10 / 12 | P6 split and phrased as "Section 2.1 ...", P7 omitted |
| Overall | 20 / 24 (83%) | |

- K1: Debye length said to replace d for all long-range interactions (neutral-plasma qualifier lost), plus "the equation" dangling.
- K4: Omega = binomial coefficient, N1 = E/eps, and "ways of choosing" sit in separate relations (4.1-4.3); none states the answer alone.
- P6: microcanonical ensemble / closed classical system split over 6.3 and 6.4, both as section-number statements.
- P7: fluctuation-dissipation theorem never extracted.
- Borderline counted as covered: K2 (2.7), P4 (4.6; nondegenerate half only via dangling "Equation (2.74)").

## 2. Standalone quality (20 per author, evenly spaced over the relation list)
| Author | Standalone + faithful | Not standalone | Unfaithful |
|---|---|---|---|
| Kardar | 13 | 5 | 2 |
| Plischke | 11 | 9 | 0 |
| Overall | 24 / 40 (60%) | 14 (35%) | 2 (5%) |

- Not standalone: "the solution", "the slot", "the chapter", "Section 2.3 ...", "Equation (2.100)", "a specific formula", unnamed system/Hamiltonian.
- Unfaithful: K1.5 (neutral plasma generalised to all long-range), K5.1 (f_2 rendered as "f squared").
- Plischke chunk P6 (chapter outline) yields 16 relations that are essentially a table of contents.

## 3. Fragmentation (case-sensitive distinct names; groups are a lower bound, judged by eye)
| Author | Distinct names | Extra names in same-thing groups | Duplicate rate |
|---|---|---|---|
| Kardar | 206 | 24 (19 groups) | 11.7% |
| Plischke | 188 | 15 (14 groups) | 8.0% |
| Overall | 394 | 39 | 9.9% |

Kardar groups: Liouville's theorem / liouville theorem; microstate(s); ensemble(s); reversible / reversible process(es) / reversible transformation; temperature(s) / T; particle(s); collision(s); energy / energy e; effective range / interaction range / d; SLepsilon / single-particle level spacing; Hamiltonian / heuscript / heuscriptlparen...; system(s); number of excited impurities / excited levels; number of impurities / available impurities; mass / mass m; T H / source temperature; T C / sink temperature; ground state / first state; excited state / second state.
Plischke groups: nonextensive measure(s); constraint(s); subsystem(s); system(s); two systems / two subsystems; macroscopic propert(y/ies); lagrange multiplier / lagrange multiplier a; state k / state labeled by k; surface V(E) / V(E) / T(E); energy / energy E; information theory / information-theoretic approach; number of (possible) sequences; number of particles / particle numbers; volume(s).
Not counted as duplicates (judgement calls): generic vs specific names (entropy / total entropy), ensemble vs "equilibrium ensemble". Junk nodes ("zero", "one", "meters", "a", "formula", "problem") inflate the count and are not duplicates.

## 4. Conflicts
| Author | Relations | Conflicting pairs | Per 100 relations |
|---|---|---|---|
| Kardar | 96 | 1 | 1.0 |
| Plischke | 89 | 0 | 0 |
| Overall | 185 | 1 | 0.5 |

- Kardar: 6.0 "s-particle density is normalized to unity" vs 6.1 "s-particle density has normalization N!/(N-s)!" (chunk distinguishes rho_s from the density; extraction merged them).
- Not counted: 6.8 vs 6.9 (three-body terms needed in general, negligible when dilute) and Plischke 10.4 vs 10.5 (isolated vs imperfectly insulated), since conditions differ.
- Chunks are on unrelated topics, so cross-chunk conflicts are unlikely to show at this size; 12 chunks cannot estimate the rate on a full corpus.

## 5. Overall
The extraction is only partly usable as a retrieval unit finer than a chunk: it captures the needed fact for about 83% of questions, but only 60% of sampled relations are clean standalone sentences, and the failures (dangling references, section-number filler, garbled symbols, lost qualifiers) are exactly what a fine unit must avoid. Node naming is moderately fragmented (about 10% duplicates, likely more with fuzzy matching), so node-based linking would need normalisation, while conflicts are rare in this sample. With 24 questions and 40 sampled relations, treat these as indicative; a fix of reference/section relations, a filter for formula-dependent and filler relations, and a check on qualifiers should come before scaling.
