"""Fitting text onto slides.

The whole problem this module solves: a block of liturgy arrives as a wall of
text and has to become N slides, none of which overflow, none of which end on a
lonely orphan line, and none of which break a stanza in a place that reads
badly.

Everything here is pure arithmetic on line counts -- no PowerPoint involved --
so it can be unit tested without opening a deck.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Iterable

# Sentence-ish boundary, used only when a single unit is too tall to fit on one
# slide and we have no better place to cut.
_SENTENCE_END = re.compile(r"(?<=[.!?;:])\s+")


@dataclass
class Capacity:
    """How much text fits on one slide at a given font size."""

    chars_per_line: int
    max_lines: int

    @classmethod
    def for_size(
        cls,
        *,
        font_pt: float,
        body_width_in: float,
        body_height_in: float,
        line_spacing: float,
        char_width_ratio: float,
    ) -> "Capacity":
        # Average glyph advance for a proportional face is roughly half the point
        # size. char_width_ratio is exposed in theme.yaml so a church using a
        # wide or narrow face can calibrate it once and forget it.
        char_w_pt = font_pt * char_width_ratio
        chars = max(8, int((body_width_in * 72.0) / char_w_pt))
        lines = max(1, int((body_height_in * 72.0) / (font_pt * line_spacing)))
        return cls(chars_per_line=chars, max_lines=lines)


@dataclass
class Line:
    """One rendered line of text plus how it should be styled."""

    text: str
    role: str = "plain"  # plain | leader | people | label | blank
    label: str = ""  # e.g. "L" or "People" -- rendered in the accent color

    def height(self, chars_per_line: int) -> int:
        """Number of visual lines this occupies once wrapped."""
        if self.role == "blank" or not self.text.strip():
            return 1
        width = len(self.text) + (len(self.label) + 2 if self.label else 0)
        return max(1, math.ceil(width / chars_per_line))


@dataclass
class Unit:
    """A group of lines that should stay together on one slide if possible.

    A stanza of a hymn, one leader/people exchange, one paragraph of a prayer.
    """

    lines: list[Line]
    breakable: bool = True  # may be split mid-unit as a last resort

    def height(self, chars_per_line: int) -> int:
        return sum(line.height(chars_per_line) for line in self.lines)

    def is_empty(self) -> bool:
        return not any(line.text.strip() for line in self.lines)

    @property
    def role(self) -> str:
        return self.lines[0].role if self.lines else "plain"


@dataclass
class Page:
    """One slide's worth of laid-out content."""

    units: list[Unit]
    font_pt: float
    header: str = ""
    footer: str = ""
    notes: str = ""
    index: int = 0  # 1-based position within its block
    total: int = 1  # how many slides the block produced
    kind: str = "text"
    meta: dict = field(default_factory=dict)

    @property
    def lines(self) -> list[Line]:
        """Flatten units back to lines, with a blank line between units."""
        out: list[Line] = []
        for unit in self.units:
            if out:
                out.append(Line("", role="blank"))
            out.extend(unit.lines)
        return out


def parse_units(text: str, *, responsive: bool = False) -> list[Unit]:
    """Turn a raw text block into units.

    Blank lines separate units. When `responsive` is set, a leader/people label
    at the start of a line also starts a new unit, so an exchange never gets
    split across the label.
    """
    units: list[Unit] = []
    current: list[Line] = []

    def flush() -> None:
        nonlocal current
        if current:
            unit = Unit(lines=current)
            if not unit.is_empty():
                units.append(unit)
        current = []

    for raw in text.splitlines():
        stripped = raw.strip()
        if not stripped:
            flush()
            continue
        line = _parse_line(stripped) if responsive else Line(stripped)
        # A new speaker starts a new unit, but only if we already have content.
        if responsive and line.label and current:
            flush()
        current.append(line)
    flush()
    return units


_LABEL_RE = re.compile(
    r"^(L|P|A|C|M|One|All|Many|Leader|People|Pastor|Congregation|Liturgist|Reader|Choir)"
    r"\s*[:.—-]\s*(.*)$",
    re.IGNORECASE,
)

_CONGREGATION = {"p", "a", "c", "all", "many", "people", "congregation"}


def _parse_line(text: str) -> Line:
    match = _LABEL_RE.match(text)
    if not match:
        return Line(text)
    label, body = match.group(1), match.group(2).strip()
    role = "people" if label.lower() in _CONGREGATION else "leader"
    return Line(body, role=role, label=label)


def _page_height(units: list[Unit], cap: Capacity) -> int:
    if not units:
        return 0
    return sum(u.height(cap.chars_per_line) for u in units) + (len(units) - 1)


def _group_exchanges(units: list[Unit]) -> list[list[Unit]]:
    """Bind each leader's line to the response that answers it.

    "Where can I go from your spirit?" belongs on the same slide as "If I take
    the wings of the morning". Grouping them before packing keeps the pair
    whole; splitting them and patching it up afterwards does not always.
    """
    groups: list[list[Unit]] = []
    current: list[Unit] = []

    for unit in units:
        if unit.role == "leader":
            if current:
                groups.append(current)
            current = [unit]
        elif unit.role == "people" and current:
            current.append(unit)
        else:
            if current:
                groups.append(current)
                current = []
            groups.append([unit])

    if current:
        groups.append(current)
    return groups


def paginate(units: list[Unit], cap: Capacity) -> list[list[Unit]]:
    """Greedily pack units into pages, splitting oversized ones as needed."""
    pages: list[list[Unit]] = []
    current: list[Unit] = []
    used = 0

    def flush() -> None:
        nonlocal current, used
        if current:
            pages.append(current)
            current, used = [], 0

    def place(chunk: list[Unit], height: int) -> None:
        nonlocal current, used
        gap = 1 if current else 0  # blank spacer line between units
        if used + gap + height > cap.max_lines:
            flush()
            current, used = list(chunk), height
        else:
            current.extend(chunk)
            used += gap + height

    for group in _group_exchanges(units):
        height = _page_height(group, cap)
        if height <= cap.max_lines:
            place(group, height)
            continue

        # The exchange is too tall to hold together; place its parts singly.
        for unit in group:
            unit_height = unit.height(cap.chars_per_line)
            if unit_height > cap.max_lines:
                flush()
                for piece in _split_unit(unit, cap):
                    pages.append([piece])
                continue
            place([unit], unit_height)

    flush()
    return _rebalance(pages, cap)


def _split_unit(unit: Unit, cap: Capacity) -> list[Unit]:
    """Cut one over-tall unit into slide-sized pieces.

    Prefers to break between whole source lines; only re-flows a single line at
    sentence boundaries when that line is itself taller than a slide.
    """
    pieces: list[Unit] = []
    current: list[Line] = []
    used = 0

    for line in unit.lines:
        height = line.height(cap.chars_per_line)
        if height > cap.max_lines:
            if current:
                pieces.append(Unit(lines=current))
                current, used = [], 0
            for chunk in _split_line(line, cap):
                pieces.append(Unit(lines=[chunk]))
            continue
        if used + height > cap.max_lines:
            pieces.append(Unit(lines=current))
            current, used = [line], height
        else:
            current.append(line)
            used += height

    if current:
        pieces.append(Unit(lines=current))
    return pieces or [unit]


def _split_line(line: Line, cap: Capacity) -> list[Line]:
    """Break one very long line into slide-sized chunks at sentence boundaries."""
    budget = cap.max_lines * cap.chars_per_line
    parts = _SENTENCE_END.split(line.text)
    chunks: list[str] = []
    buf = ""
    for part in parts:
        candidate = f"{buf} {part}".strip() if buf else part
        if buf and len(candidate) > budget:
            chunks.append(buf)
            buf = part
        else:
            buf = candidate
    if buf:
        chunks.append(buf)

    # A single sentence longer than a whole slide: fall back to a hard cut on
    # word boundaries so we never drop text.
    out: list[str] = []
    for chunk in chunks:
        while len(chunk) > budget:
            cut = chunk.rfind(" ", 0, budget)
            cut = cut if cut > 0 else budget
            out.append(chunk[:cut].strip())
            chunk = chunk[cut:].strip()
        if chunk:
            out.append(chunk)

    # Only the first chunk keeps the speaker label.
    return [
        Line(text, role=line.role, label=line.label if i == 0 else "")
        for i, text in enumerate(out)
    ]


def _rebalance(pages: list[list[Unit]], cap: Capacity) -> list[list[Unit]]:
    """Pull a unit back from a crowded page to rescue an orphaned last page.

    Two slides reading 4 stanzas + 1 stanza looks like a mistake. 3 + 2 does not.
    """
    if len(pages) < 2:
        return pages
    last, prev = pages[-1], pages[-2]
    if len(last) != 1 or len(prev) < 3:
        return pages

    moved = prev[-1]
    # Never rebalance into a state where a slide ends on the leader's line.
    if moved.role == "leader" or prev[-2].role == "leader":
        return pages

    trial = [moved] + last
    if _page_height(trial, cap) <= cap.max_lines:
        pages[-2] = prev[:-1]
        pages[-1] = trial
    return pages


def fit(
    units: list[Unit],
    *,
    sizes: Iterable[float],
    body_width_in: float,
    body_height_in: float,
    line_spacing: float,
    char_width_ratio: float,
) -> tuple[list[list[Unit]], float]:
    """Lay out units, shrinking the font only when it saves a slide.

    Tries the preferred size first. Steps down through the remaining sizes and
    keeps the first one that produces fewer slides -- so a stanza that overruns
    by one line gets a slightly smaller font instead of a near-empty second
    slide, but text that genuinely needs two slides stays at full size.
    """
    size_list = list(sizes)
    best_pages: list[list[Unit]] | None = None
    best_size = size_list[0]

    for size in size_list:
        cap = Capacity.for_size(
            font_pt=size,
            body_width_in=body_width_in,
            body_height_in=body_height_in,
            line_spacing=line_spacing,
            char_width_ratio=char_width_ratio,
        )
        pages = paginate(units, cap)
        if best_pages is None or len(pages) < len(best_pages):
            best_pages, best_size = pages, size
        if len(pages) <= 1:
            break

    return best_pages or [], best_size
