"""Turning order-of-worship elements into laid-out slides."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import yaml

from .layout import Line, Page, Unit, fit, parse_units
from .service import Service
from .theme import Theme

# Elements that are just a piece of music being performed, not sung by everyone.
MUSIC_TYPES = {
    "prelude": "Prelude",
    "postlude": "Postlude",
    "offertory": "Offertory",
    "anthem": "Anthem",
    "special_music": "Special Music",
    "music": "Music",
    "solo": "Solo",
    "handbells": "Handbells",
}

# Elements whose whole content is a named piece of liturgy we keep on file.
LIBRARY_TYPES = {
    "lords_prayer": "lords-prayer",
    "apostles_creed": "apostles-creed",
    "nicene_creed": "nicene-creed",
    "doxology": "doxology",
    "gloria_patri": "gloria-patri",
    "communion": "communion",
    "passing_the_peace": "passing-the-peace",
}

# Free text elements, mapped to the heading printed above them.
TEXT_TYPES = {
    "call_to_worship": "Call to Worship",
    "opening_prayer": "Opening Prayer",
    "prayer": "Prayer",
    "prayer_of_confession": "Prayer of Confession",
    "assurance": "Words of Assurance",
    "affirmation_of_faith": "Affirmation of Faith",
    "pastoral_prayer": "Pastoral Prayer",
    "invitation": "Invitation",
    "offering": "Offering",
    "prayer_of_dedication": "Prayer of Dedication",
    "benediction": "Benediction",
    "sending_forth": "Sending Forth",
    "responsive": "",
    "text": "",
    "liturgy": "",
}

SIMPLE_TYPES = {
    "welcome": "Welcome",
    "greeting": "Greeting",
    "announcements_verbal": "Announcements",
    "children": "Children's Message",
    "joys_and_concerns": "Joys and Concerns",
    "silence": "Silent Reflection",
}

# Where a shorthand scalar (``- scripture: John 3:16``) should land.
PRIMARY_FIELD = {
    "scripture": "reference",
    "sermon": "title",
    "hymn": "title",
    "song": "title",
    "section": "title",
    "image": "path",
    "include": "file",
}

KNOWN_TYPES: set[str] = (
    set(MUSIC_TYPES)
    | set(LIBRARY_TYPES)
    | set(TEXT_TYPES)
    | set(SIMPLE_TYPES)
    | {
        "title",
        "blank",
        "section",
        "hymn",
        "song",
        "scripture",
        "sermon",
        "flowers",
        "announcements",
        "image",
        "include",
    }
)


@dataclass
class Context:
    service: Service
    theme: Theme
    library_dir: Path
    warnings: list[str]


# --------------------------------------------------------------------------
# text helpers


def _as_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        return "\n\n".join(str(v).strip() for v in value if str(v).strip())
    return str(value)


def _lay_out(
    ctx: Context,
    text: str,
    *,
    header: str = "",
    title: str = "",
    footer: str = "",
    responsive: bool = False,
    pack: bool = True,
    notes: str = "",
    align: str = "center",
    kind: str = "text",
    start_pt: float | None = None,
    title_pt: float | None = None,
    meta: dict[str, Any] | None = None,
) -> list[Page]:
    """Lay one text element out across as many slides as it needs."""
    theme = ctx.theme
    units = parse_units(text, responsive=responsive) if text.strip() else []

    title_size = float(
        title_pt if title_pt is not None else theme.pt("card_title_pt")
    )
    title_cost_in = (title_size * 2.6 / 72.0 + 0.15) if title else 0.0

    body_height = max(
        1.0,
        theme.body_height_in(has_header=bool(header), has_footer=bool(footer))
        - title_cost_in,
    )

    # A responsive reading is set left-aligned with the wrapped lines hanging
    # under the text, so the label gutter comes out of the usable width.
    gutter_in = 0.0
    if responsive and align == "left":
        widest = max(
            (len(line.label) for unit in units for line in unit.lines if line.label),
            default=0,
        )
        gutter_in = ((widest + 2) * theme.pt("body_pt") * 0.8 * 0.5) / 72.0

    groups = [units] if pack else [[u] for u in units]
    pages: list[Page] = []
    for group in groups:
        if not group:
            continue
        laid, size = fit(
            group,
            sizes=theme.size_ladder(start_pt),
            body_width_in=theme.body_width_in - gutter_in,
            body_height_in=body_height,
            line_spacing=float(theme.opt("line_spacing")),
            char_width_ratio=float(theme.opt("char_width_ratio")),
        )
        for page_units in laid:
            pages.append(
                Page(
                    units=page_units,
                    font_pt=size,
                    header=header,
                    footer=footer,
                    notes=notes,
                    kind=kind,
                    meta={
                        "align": align,
                        "title": title,
                        "title_pt": title_size,
                        **(meta or {}),
                    },
                )
            )

    if not pages and (title or header):
        # A heading with no body still deserves its slide (e.g. "Welcome").
        pages.append(
            Page(
                units=[],
                font_pt=theme.pt("body_pt"),
                header=header,
                footer=footer,
                notes=notes,
                kind=kind,
                meta={"align": align, "title": title, **(meta or {})},
            )
        )

    for i, page in enumerate(pages, start=1):
        page.index, page.total = i, len(pages)
    return pages


def _card(
    ctx: Context,
    *,
    header: str,
    title: str,
    lines: list[str],
    footer: str = "",
    notes: str = "",
) -> list[Page]:
    """A slide that is mostly one big name plus a couple of credit lines."""
    body = "\n".join(line for line in lines if line and line.strip())
    return _lay_out(
        ctx,
        body,
        header=header,
        title=title,
        footer=footer,
        notes=notes,
        align="center",
        kind="card",
        start_pt=ctx.theme.pt("subtitle_pt"),
    )


# --------------------------------------------------------------------------
# element handlers


def _title_slide(ctx: Context) -> list[Page]:
    service = ctx.service
    subtitle_lines = [service.date_long, service.service_time]
    return [
        Page(
            units=[
                Unit(lines=[Line(t) for t in subtitle_lines if t])
            ]
            if any(subtitle_lines)
            else [],
            font_pt=ctx.theme.pt("subtitle_pt"),
            kind="title",
            notes="Hold on this slide until the prelude ends.",
            meta={"align": "center", "title": service.title or "Worship"},
        )
    ]


def h_blank(block: dict, ctx: Context) -> list[Page]:
    return [
        Page(
            units=[],
            font_pt=ctx.theme.pt("body_pt"),
            kind="blank",
            notes=str(block.get("notes") or "Black slide."),
            meta={},
        )
    ]


def h_section(block: dict, ctx: Context) -> list[Page]:
    return [
        Page(
            units=[],
            font_pt=ctx.theme.pt("title_pt"),
            kind="title",
            notes=str(block.get("notes") or ""),
            meta={"align": "center", "title": str(block.get("title") or "")},
        )
    ]


def h_simple(block: dict, ctx: Context) -> list[Page]:
    heading = SIMPLE_TYPES.get(block["type"], "")
    return _lay_out(
        ctx,
        _as_text(block.get("text")),
        header="",
        title=str(block.get("title") or heading),
        notes=str(block.get("notes") or ""),
        kind="card",
    )


def h_music(block: dict, ctx: Context) -> list[Page]:
    heading = MUSIC_TYPES[block["type"]]
    credits = [
        _as_text(block.get("composer")),
        _as_text(block.get("performer") or block.get("performers")),
        _as_text(block.get("arranger")),
    ]
    return _card(
        ctx,
        header=str(block.get("heading") or heading),
        title=_as_text(block.get("title") or block.get("value")),
        lines=credits,
        footer=_as_text(block.get("copyright")),
        notes=str(block.get("notes") or ""),
    )


def h_hymn(block: dict, ctx: Context) -> list[Page]:
    number = block.get("number")
    hymnal = str(block.get("hymnal") or ("UMH" if number else "")).strip()
    title = _as_text(block.get("title") or block.get("value"))

    header_bits = [b for b in [hymnal, str(number) if number else ""] if b]
    header = " ".join(header_bits)
    header = f"{header} · {title}" if header else title

    footer_bits = [
        _as_text(block.get("copyright")),
        f"CCLI #{block['ccli']}" if block.get("ccli") else "",
        f"CCLI License #{block['ccli_license']}" if block.get("ccli_license") else "",
        _as_text(block.get("license")),
    ]
    footer = "  ·  ".join(b for b in footer_bits if b)

    stanzas = block.get("stanzas") or block.get("verses")
    if stanzas:
        text = "\n\n".join(str(s).strip() for s in stanzas)
    else:
        text = _as_text(block.get("text"))

    if not text.strip():
        ctx.warnings.append(
            f"Hymn '{title or number}' has no stanzas: -- inserting a cue slide only."
        )
        return _card(
            ctx,
            header=hymnal or "Hymn",
            title=title or (f"No. {number}" if number else "Hymn"),
            lines=[f"Hymnal no. {number}" if number else ""],
            footer=footer,
            notes="Lyrics not in the service file; congregation uses the hymnal.",
        )

    # One stanza per slide is the norm; set ``pack: true`` to group them.
    pack = bool(block.get("pack", False))
    return _lay_out(
        ctx,
        text,
        header=header,
        footer=footer,
        pack=pack,
        align=str(block.get("align") or "center"),
        notes=str(block.get("notes") or "Advance at the end of each stanza."),
    )


def h_scripture(block: dict, ctx: Context) -> list[Page]:
    reference = _as_text(block.get("reference") or block.get("value"))
    translation = _as_text(block.get("translation") or block.get("version"))
    header = reference + (f" ({translation})" if translation else "")
    text = _as_text(block.get("text"))
    if not text.strip():
        return _card(
            ctx,
            header="Scripture Reading",
            title=reference,
            lines=[translation],
            notes="Text not supplied; read from the pulpit Bible.",
        )
    return _lay_out(
        ctx,
        text,
        header=header,
        align=str(block.get("align") or "center"),
        notes=str(block.get("notes") or ""),
        footer=_as_text(block.get("copyright")),
    )


def h_sermon(block: dict, ctx: Context) -> list[Page]:
    return _card(
        ctx,
        header=str(block.get("heading") or "Message"),
        title=_as_text(block.get("title") or block.get("value")),
        lines=[
            _as_text(block.get("preacher") or block.get("by")),
            _as_text(block.get("reference")),
        ],
        notes=str(block.get("notes") or "Go to black once the sermon begins."),
    )


def h_flowers(block: dict, ctx: Context) -> list[Page]:
    flowers = {**ctx.service.flowers, **{k: v for k, v in block.items() if k != "type"}}
    text = _as_text(flowers.get("text"))
    if not text:
        text = _flower_sentence(flowers)
    if not text:
        ctx.warnings.append(
            "A 'flowers' slide is in the order but no dedication was given."
        )
        return []
    return _lay_out(
        ctx,
        text,
        title=str(flowers.get("heading") or "Altar Flowers"),
        kind="card",
        notes="Flower dedication.",
        start_pt=ctx.theme.pt("subtitle_pt"),
    )


def _flower_sentence(flowers: dict) -> str:
    """Assemble the dedication from whichever fields were filled in."""
    given_by = _as_text(flowers.get("given_by") or flowers.get("from"))
    parts: list[str] = []
    if given_by:
        parts.append(f"The altar flowers are given by {given_by}")
    else:
        parts.append("The altar flowers are given")

    for key, phrase in (
        ("in_memory_of", "in loving memory of"),
        ("in_honor_of", "in honor of"),
        ("in_celebration_of", "in celebration of"),
        ("in_thanksgiving_for", "in thanksgiving for"),
    ):
        value = _as_text(flowers.get(key))
        if value:
            parts.append(f"{phrase} {value}")

    if len(parts) == 1 and not given_by:
        return ""
    sentence = ", ".join(parts).strip() + "."
    return sentence[0].upper() + sentence[1:]


def h_announcements(block: dict, ctx: Context) -> list[Page]:
    items = block.get("items") or ctx.service.announcements
    if not items:
        ctx.warnings.append(
            "An 'announcements' slide is in the order but none were written."
        )
        return []

    heading = str(block.get("heading") or "Announcements")
    pages: list[Page] = []
    for item in items:
        if isinstance(item, str):
            item = {"title": item}
        detail = "\n".join(
            v
            for v in (
                _as_text(item.get("when")),
                _as_text(item.get("where")),
            )
            if v
        )
        body = _as_text(item.get("body") or item.get("text"))
        text = "\n\n".join(part for part in (detail, body) if part)
        pages.extend(
            _lay_out(
                ctx,
                text,
                header=heading,
                title=_as_text(item.get("title")),
                kind="card",
                notes=str(item.get("notes") or ""),
                start_pt=ctx.theme.pt("subtitle_pt"),
            )
        )
    return pages


def h_image(block: dict, ctx: Context) -> list[Page]:
    path = _as_text(block.get("path") or block.get("value"))
    resolved = (ctx.service.path.parent / path).resolve()
    if not resolved.exists():
        alt = (ctx.library_dir.parent / path).resolve()
        resolved = alt if alt.exists() else resolved
    if not resolved.exists():
        ctx.warnings.append(f"Image not found: {path}")
        return []
    return [
        Page(
            units=[],
            font_pt=ctx.theme.pt("subtitle_pt"),
            kind="image",
            footer=_as_text(block.get("credit")),
            notes=str(block.get("notes") or ""),
            meta={"path": str(resolved), "caption": _as_text(block.get("caption"))},
        )
    ]


def h_text(block: dict, ctx: Context) -> list[Page]:
    heading = TEXT_TYPES.get(block["type"], "")
    header = str(block.get("heading") or block.get("title") or heading)
    text = _as_text(block.get("text") or block.get("value"))

    if not text.strip():
        source = _as_text(block.get("source"))
        return _card(
            ctx,
            header="",
            title=header,
            lines=[source],
            notes=str(block.get("notes") or ""),
        )

    responsive = bool(block.get("responsive", _looks_responsive(text)))
    source = _as_text(block.get("source"))
    return _lay_out(
        ctx,
        text,
        header=header + (f"  ·  {source}" if source else ""),
        responsive=responsive,
        align=str(block.get("align") or ("left" if responsive else "center")),
        notes=str(block.get("notes") or ""),
        footer=_as_text(block.get("copyright")),
    )


def _looks_responsive(text: str) -> bool:
    from .layout import _LABEL_RE

    labelled = sum(1 for line in text.splitlines() if _LABEL_RE.match(line.strip()))
    return labelled >= 2


def h_library(block: dict, ctx: Context) -> list[Page]:
    name = LIBRARY_TYPES.get(block["type"]) or _as_text(
        block.get("file") or block.get("value")
    )
    path = ctx.library_dir / f"{name}.yaml"
    if not path.exists():
        ctx.warnings.append(
            f"Library file missing: library/{name}.yaml. "
            f"Create it, or put the words directly in the service file."
        )
        return _card(
            ctx,
            header="",
            title=block["type"].replace("_", " ").title(),
            lines=["[text not yet in the library]"],
            notes=f"Add library/{name}.yaml",
        )

    data = yaml.safe_load(path.read_text()) or {}
    merged = {**data, **{k: v for k, v in block.items() if k not in {"type", "_index"}}}
    text = _as_text(merged.get("text"))
    responsive = bool(merged.get("responsive", _looks_responsive(text)))
    return _lay_out(
        ctx,
        text,
        header=str(merged.get("header") or merged.get("title") or ""),
        responsive=responsive,
        pack=bool(merged.get("pack", True)),
        align=str(merged.get("align") or ("left" if responsive else "center")),
        footer=_as_text(merged.get("copyright")),
        notes=str(merged.get("notes") or ""),
    )


HANDLERS: dict[str, Callable[[dict, Context], list[Page]]] = {
    "blank": h_blank,
    "section": h_section,
    "hymn": h_hymn,
    "song": h_hymn,
    "scripture": h_scripture,
    "sermon": h_sermon,
    "flowers": h_flowers,
    "announcements": h_announcements,
    "image": h_image,
    "include": h_library,
}
HANDLERS.update({key: h_music for key in MUSIC_TYPES})
HANDLERS.update({key: h_library for key in LIBRARY_TYPES})
HANDLERS.update({key: h_text for key in TEXT_TYPES})
HANDLERS.update({key: h_simple for key in SIMPLE_TYPES})


def build_pages(service: Service, theme: Theme, library_dir: Path) -> tuple[list[Page], list[str]]:
    ctx = Context(
        service=service, theme=theme, library_dir=library_dir, warnings=[]
    )
    pages: list[Page] = []

    if service.raw.get("title_slide", True):
        pages.extend(_title_slide(ctx))

    for block in service.order:
        handler = HANDLERS.get(block["type"], h_text)
        produced = handler(block, ctx)
        for page in produced:
            page.meta.setdefault("element", block["type"])
        pages.extend(produced)

    return pages, ctx.warnings
