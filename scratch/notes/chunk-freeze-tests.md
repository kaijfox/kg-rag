# chunk freeze tests

New file: packages/chunk/test/freeze.test.ts (51 cases; suite 117 pass, typecheck clean, src unchanged).
Harness: scratchpad/mut.py applies 91 one-token mutants to src in place (restored from a backup copy after each), runs vitest.
Result: 86 killed by the full suite, 5 survived (below); 81 killed by freeze.test.ts alone, the rest by the existing split/chunker tests.

Per item (mutants tried -> killed):
- T/M/m boundaries: `<=`->`<`, `<=`->`<=+1`, `curLen<minChars`->`<=`/`<m-1`, `||`->`&&`, join +2->+1. Killed. Second parameter set (50/80/10) added; m is tested on the running length with 2 per join.
- final merge: last `<`->`<=`/`<m-1`, M `<=`->`<`, +2->+1, `length>=2`->`>2`, guard off, M term dropped, chunkLength joins 2->1 / none, splice count. Killed.
- page sort/dedup: `.sort()`, descending, no sort, no dedup (chunk level). Killed. Survivors: dedup removed only in the inline-group or table `pages` expression: equivalent, because the chunk-level Set dedups again.
- block-ref dedup, visited dedup (visit, takeCaptions, markChildrenVisited, inlineTexts check/add/skipped-ref): all killed.
- inline join: join('') / '\n' / '  ', filter removed, formula measured at raw text, measure `<=`->`<` (needs decoded formula group of exactly M), inline refs. Killed.
- furniture: label header/footer checks, `&&`->`||`, layer default, layer ignored, `!== 'furniture'` (invisible layer), isBody dropped in visit and in inline. Killed. Pinned behaviour: any content_layer other than body (or missing) is skipped whatever the label; page_header/page_footer skipped whatever the layer; a furniture section_header opens no section; furniture group skipped with children; furniture children of an inline group dropped from text and refs.
- `\p{Lu}`: `[A-Z]`, `\p{L}`, `[\p{Lu}\p{Lt}]`, `\P{Ll}`, `\s+`->`\s*`/` +`. Killed (E, A-umlaut, Zhe, Omega cut; lowercase, digit, quote, titlecase Lt, modifier Lm, no-whitespace do not; newline/tab/NBSP runs cut).
- surrogates: guard off, `k-=0`, index k-1->k, range edges 0xd800/0xdbff (>,<, d7ff, dfff, &&->||; tested with U+10000, U+10FFFF and neighbours D7FF/E000/DC00), `hard===0` guard off, fromCodePoint length->1. Killed.
- split guard `>`->`>=` / `>m+1`, longest/shortest prefix comparisons: killed (also through the chunker and with whitespace runs).
- formula: measure raw / +1 / FORMULA_MEASURE-1, `if(formula)` unsplit path off, label check off, normText check -> `text===''`, inline formula placeholder / inlineItemText. Killed (9 = T exactly with a 4000-char decoded formula).
- ref regex: no `^`, no `$`, leading zero allowed, no zero, single digit, dot for slash, collection names, unresolved-ok. Killed.

Surviving (equivalent, no observable behaviour):
- `m.index + 1 > k` -> `>= k`: the whitespace after the period is trailing in the prefix, so k is always > period index+1.
- `cut > 0` -> `cut >= 0`: cut is -1 or >= 1.
- `k > 0 &&` -> `k >= 0 &&`: charCodeAt(-1) is NaN.
- the two page `Set`s inside the inline/table emit (see above).

## Bug found (not fixed, test left out)
`splitBlock('\u{1F600}\u{1F600}', 1)` returns `['😀','😀','']`: a trailing empty piece. Cause: when maxChars is smaller than one astral character, the hard-cut branch takes the whole character, so `rest` reaches '' and the loop's final `pieces.push(rest)` pushes it. Input maxChars=1 is unrealistic (recipes use >= hundreds), and for `'😀x'` it is fine. Through the chunker an empty block would be a block with text '' (measure 0). Expected: no empty piece. Changing it changes output only for this degenerate recipe.
