"""Two things worth having besides the deck itself.

A plain-text proof, so the whole service can be read through on a phone before
Sunday without opening PowerPoint, and a song-usage CSV for CCLI / OneLicense
reporting.
"""

from __future__ import annotations

import csv
from pathlib import Path

from .layout import Page
from .service import Service

SONG_TYPES = {"hymn", "song", "anthem", "offertory", "prelude", "postlude",
              "special_music", "solo", "handbells", "music"}


def write_proof(pages: list[Page], service: Service, path: Path) -> Path:
    out: list[str] = []
    header = f"{service.title or 'Worship'} — {service.date_long}".strip(" —")
    out.append(header)
    out.append(f"{len(pages)} slides · generated from {service.path.name}")
    out.append("=" * 72)

    for number, page in enumerate(pages, start=1):
        element = page.meta.get("element", page.kind)
        stamp = f"[{number:>3}] {element}"
        if page.total > 1:
            stamp += f" ({page.index}/{page.total})"
        out.append("")
        out.append(stamp)
        out.append("-" * 72)
        if page.header:
            out.append(f"  « {page.header} »")
        if page.meta.get("title"):
            out.append(f"  {page.meta['title'].upper()}")
        for line in page.lines:
            if line.role == "blank":
                out.append("")
            elif line.label:
                out.append(f"  {line.label}: {line.text}")
            else:
                out.append(f"  {line.text}")
        if page.footer:
            out.append(f"  ({page.footer})")
        if page.kind == "blank":
            out.append("  [black slide]")

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(out) + "\n")
    return path


def write_song_report(service: Service, path: Path) -> Path:
    rows = []
    for block in service.order:
        if block["type"] not in SONG_TYPES:
            continue
        rows.append(
            {
                "date": service.date.isoformat() if service.date else "",
                "element": block["type"],
                "hymnal": block.get("hymnal", ""),
                "number": block.get("number", ""),
                "title": block.get("title", ""),
                "author": block.get("author", ""),
                "composer": block.get("composer", ""),
                "copyright": block.get("copyright", ""),
                "ccli": block.get("ccli", ""),
                "onelicense": block.get("onelicense", ""),
                "words_projected": "yes" if block.get("stanzas") or block.get("text") else "no",
            }
        )

    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "date", "element", "hymnal", "number", "title", "author",
                "composer", "copyright", "ccli", "onelicense", "words_projected",
            ],
        )
        writer.writeheader()
        writer.writerows(rows)
    return path
