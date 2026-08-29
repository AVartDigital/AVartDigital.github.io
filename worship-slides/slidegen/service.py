"""Loading and validating one Sunday's service file."""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml


class ServiceError(Exception):
    """The service file is wrong in a way we cannot guess our way past."""


@dataclass
class Service:
    path: Path
    date: dt.date | None
    title: str
    service_time: str
    communion: bool
    flowers: dict[str, Any]
    announcements: list[dict[str, Any]]
    order: list[dict[str, Any]]
    raw: dict[str, Any] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)

    @property
    def date_long(self) -> str:
        if not self.date:
            return ""
        # Cross-platform day-without-leading-zero.
        return f"{self.date:%B} {self.date.day}, {self.date:%Y}"

    @property
    def slug(self) -> str:
        return self.date.isoformat() if self.date else self.path.stem


def load(
    path: Path,
    known_types: set[str],
    primary_field: dict[str, str] | None = None,
) -> Service:
    data = yaml.safe_load(Path(path).read_text()) or {}
    if not isinstance(data, dict):
        raise ServiceError(f"{path}: expected a YAML mapping at the top level.")

    meta = data.get("service") or {}
    order_raw = data.get("order")
    if not order_raw:
        raise ServiceError(f"{path}: no 'order:' list -- nothing to build.")

    warnings: list[str] = []
    order = [
        _normalize(entry, index, known_types, warnings, primary_field or {})
        for index, entry in enumerate(order_raw, start=1)
    ]

    date = meta.get("date")
    if isinstance(date, str):
        try:
            date = dt.date.fromisoformat(date.strip())
        except ValueError:
            warnings.append(f"Could not read date {date!r}; expected YYYY-MM-DD.")
            date = None
    elif isinstance(date, dt.datetime):
        date = date.date()
    elif not isinstance(date, dt.date):
        date = None

    announcements = data.get("announcements") or []
    if isinstance(announcements, dict):
        announcements = [announcements]
    announcements = [
        {"title": a} if isinstance(a, str) else dict(a) for a in announcements
    ]

    service = Service(
        path=Path(path),
        date=date,
        title=str(meta.get("title") or "").strip(),
        service_time=str(meta.get("time") or "").strip(),
        communion=bool(meta.get("communion", False)),
        flowers=dict(data.get("flowers") or {}),
        announcements=announcements,
        order=order,
        raw=data,
        warnings=warnings,
    )
    service.warnings.extend(_lint(service))
    return service


def _normalize(
    entry: Any,
    index: int,
    known_types: set[str],
    warnings: list[str],
    primary_field: dict[str, str],
) -> dict[str, Any]:
    """Accept the three shapes a person might reasonably write.

    - ``- welcome``                          (bare string)
    - ``- type: hymn`` + sibling keys        (explicit)
    - ``- hymn: {number: 57, ...}``          (single-key shorthand)
    """
    if isinstance(entry, str):
        return {"type": entry.strip()}

    if not isinstance(entry, dict):
        raise ServiceError(f"order[{index}]: expected a string or mapping, got {entry!r}")

    if "type" in entry:
        block = dict(entry)
    elif len(entry) == 1:
        (key, value), = entry.items()
        if isinstance(value, dict):
            block = {"type": key, **value}
        elif value is None:
            block = {"type": key}
        else:
            # ``- scripture: John 3:16`` -- put the scalar somewhere sensible.
            block = {"type": key, "value": value}
    else:
        raise ServiceError(
            f"order[{index}]: mapping has several keys but no 'type:'. "
            f"Keys were: {', '.join(sorted(entry))}"
        )

    block["type"] = str(block["type"]).strip().lower().replace("-", "_").replace(" ", "_")

    # ``- scripture: John 3:16`` -- move the scalar into the field that element
    # actually reads, so everything downstream sees one consistent shape.
    if "value" in block:
        target = primary_field.get(block["type"], "text")
        block.setdefault(target, block.pop("value"))

    if block["type"] not in known_types:
        warnings.append(
            f"order[{index}]: unknown element '{block['type']}' -- "
            "rendering it as a plain text slide."
        )
    block.setdefault("_index", index)
    return block


def _lint(service: Service) -> list[str]:
    """Catch the mistakes that only show up on Sunday morning."""
    out: list[str] = []
    types = [b["type"] for b in service.order]

    if service.communion and "communion" not in types:
        out.append(
            "service.communion is true but no 'communion' element is in the order."
        )
    if not service.communion and "communion" in types:
        out.append(
            "A 'communion' element is in the order but service.communion is false."
        )
    if service.flowers and "flowers" not in types:
        out.append(
            "Flower dedication is filled in but no 'flowers' slide is in the order."
        )
    if service.announcements and "announcements" not in types:
        out.append(
            f"{len(service.announcements)} announcement(s) written but no "
            "'announcements' slide is in the order."
        )
    if not service.date:
        out.append("service.date is missing -- the title slide will have no date.")

    for block in service.order:
        if block["type"] in {"hymn", "song"} and not block.get("copyright"):
            name = block.get("title") or block.get("number") or "untitled"
            out.append(
                f"'{name}' has no copyright: field. Put 'Public Domain' or the "
                "CCLI license line there so the footer is correct."
            )
    return out
