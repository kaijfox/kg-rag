"""Exception types mapped onto the CLI exit codes (see README)."""


class KgParseError(Exception):
    """Base class. The CLI reports these on stderr without a traceback."""


class RecipeError(KgParseError):
    """Exit 3: the recipe is invalid, names an unknown option, or does not match the artifact or the installed docling."""


class SourceMismatchError(KgParseError):
    """Exit 4: the PDF's sha256 differs from the artifact's sourceSha256."""
