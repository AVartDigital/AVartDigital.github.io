#!/usr/bin/env python3
"""Build Sunday's worship slides from a service file.

    python build.py services/2026-09-06.yaml
    python build.py services/2026-09-06.yaml --check     # validate only
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from slidegen.blocks import KNOWN_TYPES, PRIMARY_FIELD, build_pages
from slidegen.report import write_proof, write_song_report
from slidegen.service import ServiceError, load
from slidegen.theme import Theme

ROOT = Path(__file__).resolve().parent


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("service", type=Path, help="the week's service YAML file")
    parser.add_argument("--out", type=Path, default=ROOT / "out", help="output folder")
    parser.add_argument("--theme", type=Path, default=ROOT / "theme.yaml")
    parser.add_argument("--library", type=Path, default=ROOT / "library")
    parser.add_argument(
        "--check",
        action="store_true",
        help="validate and print the slide list without writing a .pptx",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="exit non-zero if there are any warnings",
    )
    args = parser.parse_args(argv)

    if not args.service.exists():
        print(f"error: no such service file: {args.service}", file=sys.stderr)
        return 2

    try:
        service = load(args.service, KNOWN_TYPES, PRIMARY_FIELD)
    except ServiceError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    theme = Theme.load(args.theme)
    pages, build_warnings = build_pages(service, theme, args.library)
    warnings = service.warnings + build_warnings

    if not pages:
        print("error: the service file produced no slides.", file=sys.stderr)
        return 2

    proof = write_proof(pages, service, args.out / f"{service.slug}-proof.txt")
    songs = write_song_report(service, args.out / f"{service.slug}-songs.csv")

    if args.check:
        print(proof.read_text())
    else:
        from slidegen.render import render

        deck = render(pages, theme, args.out / f"{service.slug}-worship.pptx")
        print(f"deck   {deck}")

    print(f"proof  {proof}")
    print(f"songs  {songs}")
    print(f"slides {len(pages)}")

    if warnings:
        print(f"\n{len(warnings)} thing(s) to look at:", file=sys.stderr)
        for warning in warnings:
            print(f"  - {warning}", file=sys.stderr)
        if args.strict:
            return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
