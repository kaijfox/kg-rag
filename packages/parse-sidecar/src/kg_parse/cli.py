"""kg-parse command line. Exit codes: 0 ok, 2 parse or decode failure (traceback on stderr), 3 recipe
invalid or mismatched, 4 source PDF sha256 differs from the artifact."""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
import traceback

from . import __version__
from .errors import KgParseError, RecipeError, SourceMismatchError

EXIT_OK = 0
EXIT_FAILURE = 2
EXIT_RECIPE = 3
EXIT_SOURCE = 4


def _emit(obj) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def cmd_version(_args) -> int:
    from .recipe import installed_docling_version

    _emit({"doclingVersion": installed_docling_version(), "sidecar": __version__})
    return EXIT_OK


def cmd_check_recipe(args) -> int:
    from .recipe import load_recipe, check_docling_version

    recipe = load_recipe(args.recipe)
    check_docling_version(recipe)
    sys.stdout.write(json.dumps(recipe, indent=2, ensure_ascii=False) + "\n")
    return EXIT_OK


def cmd_parse(args) -> int:
    from .envelope import write_artifact
    from .parse import parse_pdf
    from .recipe import load_recipe

    recipe = load_recipe(args.recipe)
    envelope = parse_pdf(pathlib.Path(args.input), recipe, name=args.name)
    path = write_artifact(envelope, args.out, recipe)
    _emit({"path": str(path), "sourceSha256": envelope["sourceSha256"], "stats": envelope["stats"]})
    return EXIT_OK


def cmd_decode_formulas(args) -> int:
    from .envelope import read_artifact, write_artifact
    from .formulas import check_decode_inputs, decode_formulas
    from .recipe import load_recipe

    artifact = read_artifact(args.artifact)
    recipe = load_recipe(args.recipe)
    pdf = pathlib.Path(args.pdf)
    fd = check_decode_inputs(artifact, recipe, pdf)
    from .decoder import MlxFormulaDecoder

    decoder = MlxFormulaDecoder(fd["model"], fd["revision"])
    new_artifact, counts = decode_formulas(artifact, pdf, recipe, decoder)
    path = write_artifact(new_artifact, args.out, recipe)
    _emit({"path": str(path), "sourceSha256": new_artifact["sourceSha256"],
           "decoded": counts["decoded"], "failed": counts["failed"]})
    return EXIT_OK


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="kg-parse", description=__doc__.split("\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("version", help="print docling and sidecar versions as JSON")

    p = sub.add_parser("check-recipe", help="validate a parse recipe and echo it")
    p.add_argument("recipe")

    p = sub.add_parser("parse", help="parse a PDF into a kg-parse artifact")
    p.add_argument("--input", required=True)
    p.add_argument("--recipe", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--name")

    p = sub.add_parser("decode-formulas", help="decode formula blocks of an artifact with GLM-OCR (mlx-vlm)")
    p.add_argument("--artifact", required=True)
    p.add_argument("--pdf", required=True)
    p.add_argument("--recipe", required=True)
    p.add_argument("--out", required=True)
    return parser


HANDLERS = {
    "version": cmd_version,
    "check-recipe": cmd_check_recipe,
    "parse": cmd_parse,
    "decode-formulas": cmd_decode_formulas,
}


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return HANDLERS[args.command](args)
    except RecipeError as exc:
        sys.stderr.write(f"kg-parse: recipe error: {exc}\n")
        return EXIT_RECIPE
    except SourceMismatchError as exc:
        sys.stderr.write(f"kg-parse: source error: {exc}\n")
        return EXIT_SOURCE
    except KgParseError as exc:
        sys.stderr.write(f"kg-parse: {exc}\n")
        return EXIT_FAILURE
    except Exception:
        traceback.print_exc()
        return EXIT_FAILURE


if __name__ == "__main__":
    sys.exit(main())
