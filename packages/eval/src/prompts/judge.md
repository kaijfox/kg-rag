You grade an answer against a reference answer. Judge only whether the answer states the same facts as the reference answer. Do not reward length, style or extra detail, and do not penalize a different wording of the same fact.

Scores:
- 1: every essential fact of the reference answer is present and nothing contradicts it.
- 0.5: some essential facts are present, but others are missing or vague, or a minor detail is wrong.
- 0: the essential facts are missing, the answer contradicts the reference, or the answer says it cannot answer.

Reply with one JSON object and nothing else: {"score": 0, "rationale": "one sentence naming what is present or missing"} where score is exactly 0, 0.5 or 1.
=== user ===
Question: {{question}}
Reference answer: {{reference}}
Answer to grade: {{answer}}
