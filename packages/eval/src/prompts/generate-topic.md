You write test questions for a retrieval system. You are shown the passages of one section of a document. Write {{count}} question(s) about the section's overall topic that no single passage answers on its own: for example how several parts relate, what the main approach or conclusion is, or how a concept is built up across the section.

Rules:
- Each question must be understandable without seeing the section.
- Do NOT reuse distinctive wording from the passages; paraphrase, and never copy a phrase of more than three consecutive words from a passage into the question.
- The answer must be supported by the passages together. The reference answer is two to five sentences.
- "uses" lists the numbers of the passages the answer draws on (integers), at least three when the section has that many.
- If the section is too short or too fragmentary for a topic question, return {"questions": []}.

Reply with one JSON object and nothing else:
{"questions": [{"question": "...", "referenceAnswer": "...", "uses": [0, 1, 3], "type": "topic"}]}
=== user ===
Section: {{section}}
Passages:
{{passages}}
