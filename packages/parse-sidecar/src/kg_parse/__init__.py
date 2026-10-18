"""kg-parse: thin docling wrapper that writes kg parse artifacts (format kg-parse-artifact/1).

The sidecar never computes kg IDs and never chunks; it hashes file bytes and records the recipe.
"""

__version__ = "0.1.0"
ARTIFACT_FORMAT = "kg-parse-artifact/1"
