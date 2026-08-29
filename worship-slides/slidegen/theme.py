"""Theme loading: colors, fonts, sizes, and the slide geometry."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

DEFAULTS: dict[str, Any] = {
    "slide": {"width_in": 13.333, "height_in": 7.5},
    "colors": {
        "background": "101820",
        "text": "F4F6F8",
        "accent": "C6A664",
        "muted": "8D97A5",
        "title_background": "0A1018",
    },
    "fonts": {"body": "Georgia", "heading": "Georgia", "ui": "Arial"},
    "type": {
        "body_pt": 34,
        "min_body_pt": 24,
        "heading_pt": 22,
        "title_pt": 50,
        "card_title_pt": 38,
        "subtitle_pt": 26,
        "footer_pt": 11,
    },
    "margins": {"x_in": 1.0, "top_in": 0.55, "bottom_in": 0.65},
    "layout": {
        "line_spacing": 1.22,
        "char_width_ratio": 0.5,
        "header_gap_in": 0.3,
        "shrink_step_pt": 2,
        "max_shrink_pt": 6,
        "show_page_numbers": True,
        "show_labels": True,
    },
}


def _merge(base: dict, override: dict) -> dict:
    out = dict(base)
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _merge(out[key], value)
        else:
            out[key] = value
    return out


@dataclass
class Theme:
    data: dict[str, Any] = field(default_factory=lambda: DEFAULTS)

    @classmethod
    def load(cls, path: Path | None) -> "Theme":
        if path is None or not Path(path).exists():
            return cls(DEFAULTS)
        loaded = yaml.safe_load(Path(path).read_text()) or {}
        return cls(_merge(DEFAULTS, loaded))

    # -- geometry ---------------------------------------------------------
    @property
    def width_in(self) -> float:
        return float(self.data["slide"]["width_in"])

    @property
    def height_in(self) -> float:
        return float(self.data["slide"]["height_in"])

    @property
    def body_width_in(self) -> float:
        return self.width_in - 2 * float(self.data["margins"]["x_in"])

    def body_height_in(self, *, has_header: bool, has_footer: bool) -> float:
        margins = self.data["margins"]
        height = self.height_in - float(margins["top_in"]) - float(margins["bottom_in"])
        if has_header:
            height -= (
                float(self.data["type"]["heading_pt"]) / 72.0
                + float(self.data["layout"]["header_gap_in"])
            )
        if has_footer:
            height -= float(self.data["type"]["footer_pt"]) * 2.0 / 72.0
        return max(1.0, height)

    # -- convenience accessors -------------------------------------------
    def color(self, name: str) -> str:
        return str(self.data["colors"][name]).lstrip("#")

    def font(self, name: str) -> str:
        return str(self.data["fonts"][name])

    def pt(self, name: str) -> float:
        return float(self.data["type"][name])

    def opt(self, name: str) -> Any:
        return self.data["layout"][name]

    def size_ladder(self, start_pt: float | None = None) -> list[float]:
        """Font sizes to try, largest first.

        Bounded by max_shrink_pt rather than running all the way down to
        min_body_pt: shrinking a little to rescue an orphan slide is good,
        but shrinking ten points to cram a whole responsive reading onto one
        slide gives you a wall of small text. Past the bound we split instead.
        """
        top = float(start_pt or self.pt("body_pt"))
        floor = max(
            float(self.pt("min_body_pt")), top - float(self.opt("max_shrink_pt"))
        )
        step = float(self.opt("shrink_step_pt")) or 2.0
        sizes, size = [], top
        while size >= floor:
            sizes.append(round(size, 1))
            size -= step
        if not sizes:
            sizes.append(top)
        return sizes
