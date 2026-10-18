You write test questions for a retrieval system. You are shown several passages that are linked (they discuss related things). Write {{count}} question(s) whose answer needs information from at least two different passages and cannot be answered from any single one of them.

Rules:
- Each question must be understandable without seeing the passages and must read like something a researcher would ask a colleague.
- The answer must depend on ALL the passages you list in "uses". If one listed passage could be removed and the answer would still follow, do not list it, or write a different question.
- Do NOT reuse distinctive wording from the passages. Paraphrase, and never copy a phrase of more than three consecutive words from a passage into the question.
- The answer must be fully supported by the passages together. Do not use outside knowledge to make the question answerable.
- The reference answer is one to four sentences and states only what the passages support.
- "uses" lists the passage numbers (as integers) that the answer needs, at least two.
- If the passages cannot support such a question, return {"questions": []}.

Reply with one JSON object and nothing else:
{"questions": [{"question": "...", "referenceAnswer": "...", "uses": [0, 2], "type": "multi-hop"}]}
=== user ===
Passages:
{{passages}}
