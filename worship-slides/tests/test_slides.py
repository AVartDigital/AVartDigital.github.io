"""Tests for the parts that decide where slides break.

    python -m unittest discover -s tests -v
"""

from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from slidegen.blocks import (  # noqa: E402
    KNOWN_TYPES,
    PRIMARY_FIELD,
    _flower_sentence,
    build_pages,
)
from slidegen.layout import Capacity, fit, paginate, parse_units  # noqa: E402
from slidegen.service import ServiceError, load  # noqa: E402
from slidegen.theme import Theme  # noqa: E402


def words(text: str) -> list[str]:
    return re.findall(r"[\w']+", text.lower())


class ParseUnits(unittest.TestCase):
    def test_blank_lines_separate_units(self):
        units = parse_units("one\ntwo\n\nthree\n")
        self.assertEqual(len(units), 2)
        self.assertEqual([l.text for l in units[0].lines], ["one", "two"])

    def test_labels_are_split_off_and_roled(self):
        units = parse_units("L: Lift up your hearts.\nP: We lift them up.", responsive=True)
        self.assertEqual(len(units), 2)
        self.assertEqual(units[0].lines[0].label, "L")
        self.assertEqual(units[0].lines[0].role, "leader")
        self.assertEqual(units[0].lines[0].text, "Lift up your hearts.")
        self.assertEqual(units[1].role, "people")

    def test_long_form_labels(self):
        units = parse_units("Leader: Come.\nPeople: We come.", responsive=True)
        self.assertEqual(units[0].role, "leader")
        self.assertEqual(units[1].role, "people")

    def test_speaker_change_starts_a_new_unit_without_a_blank_line(self):
        units = parse_units("L: a\nb\nP: c", responsive=True)
        self.assertEqual(len(units), 2)
        self.assertEqual([l.text for l in units[0].lines], ["a", "b"])

    def test_a_colon_mid_sentence_is_not_a_label(self):
        units = parse_units("Hear these words: God is love.", responsive=True)
        self.assertEqual(units[0].lines[0].label, "")


class Pagination(unittest.TestCase):
    def setUp(self):
        self.cap = Capacity(chars_per_line=40, max_lines=6)

    def test_units_pack_until_full(self):
        units = parse_units("\n\n".join(["a\nb"] * 4))
        pages = paginate(units, self.cap)
        self.assertEqual(len(pages), 2)

    def test_oversized_unit_is_split_and_keeps_every_word(self):
        stanza = "\n".join(f"line number {n}" for n in range(20))
        pages = paginate(parse_units(stanza), self.cap)
        self.assertGreater(len(pages), 1)
        for page in pages:
            height = sum(u.height(self.cap.chars_per_line) for u in page)
            self.assertLessEqual(height, self.cap.max_lines)
        rendered = " ".join(
            line.text for page in pages for unit in page for line in unit.lines
        )
        self.assertEqual(words(rendered), words(stanza))

    def test_a_single_line_longer_than_a_slide_is_wrapped_not_dropped(self):
        long_line = " ".join(["word"] * 200)
        pages = paginate(parse_units(long_line), Capacity(chars_per_line=20, max_lines=3))
        rendered = " ".join(
            line.text for page in pages for unit in page for line in unit.lines
        )
        self.assertEqual(len(words(rendered)), 200)

    def test_a_slide_never_ends_on_the_leader_line(self):
        text = "\n".join(
            f"{'L' if n % 2 == 0 else 'P'}: line {n} of the reading" for n in range(10)
        )
        pages = paginate(
            parse_units(text, responsive=True),
            Capacity(chars_per_line=40, max_lines=9),
        )
        self.assertGreater(len(pages), 1)
        for page in pages[:-1]:
            self.assertNotEqual(
                page[-1].role, "leader", "a call was orphaned from its response"
            )

    def test_last_page_is_not_left_with_a_lone_orphan(self):
        units = parse_units("\n\n".join(["one line"] * 7))
        pages = paginate(units, Capacity(chars_per_line=40, max_lines=11))
        self.assertEqual(len(pages), 2)
        self.assertGreater(len(pages[-1]), 1)


class Fitting(unittest.TestCase):
    def test_shrinks_a_little_to_save_a_slide(self):
        # Eleven short lines: too tall at 34pt, fine a couple of points down.
        units = parse_units("\n".join(f"short line {n}" for n in range(11)))
        pages, size = fit(
            units,
            sizes=[34, 32, 30, 28],
            body_width_in=11.3,
            body_height_in=5.4,
            line_spacing=1.22,
            char_width_ratio=0.5,
        )
        self.assertEqual(len(pages), 1)
        self.assertLess(size, 34)

    def test_does_not_shrink_when_the_preferred_size_already_fits(self):
        units = parse_units("one\ntwo")
        pages, size = fit(
            units,
            sizes=[34, 32, 30],
            body_width_in=11.3,
            body_height_in=5.4,
            line_spacing=1.22,
            char_width_ratio=0.5,
        )
        self.assertEqual((len(pages), size), (1, 34))

    def test_splits_rather_than_shrinking_past_the_bound(self):
        units = parse_units("\n".join(f"line {n}" for n in range(30)))
        pages, size = fit(
            units,
            sizes=[34, 32, 30, 28],
            body_width_in=11.3,
            body_height_in=5.4,
            line_spacing=1.22,
            char_width_ratio=0.5,
        )
        self.assertGreater(len(pages), 1)
        self.assertGreaterEqual(size, 28)


class Theming(unittest.TestCase):
    def test_ladder_stops_at_the_shrink_bound(self):
        theme = Theme.load(ROOT / "theme.yaml")
        ladder = theme.size_ladder()
        self.assertEqual(ladder[0], theme.pt("body_pt"))
        self.assertGreaterEqual(
            ladder[-1], theme.pt("body_pt") - theme.opt("max_shrink_pt")
        )


class Flowers(unittest.TestCase):
    def test_combines_the_fields_that_were_filled_in(self):
        sentence = _flower_sentence(
            {"given_by": "the Smith family", "in_memory_of": "Ruth Smith"}
        )
        self.assertEqual(
            sentence,
            "The altar flowers are given by the Smith family, "
            "in loving memory of Ruth Smith.",
        )

    def test_empty_dedication_produces_nothing(self):
        self.assertEqual(_flower_sentence({}), "")


class ServiceFile(unittest.TestCase):
    def test_the_three_ways_of_writing_an_element_all_work(self):
        import tempfile

        source = """
service: {date: 2026-09-06, title: Test}
order:
  - welcome
  - {type: sermon, title: Explicit}
  - sermon: {title: Shorthand}
  - scripture: John 3:16
"""
        with tempfile.NamedTemporaryFile("w", suffix=".yaml", delete=False) as handle:
            handle.write(source)
            path = Path(handle.name)

        service = load(path, KNOWN_TYPES, PRIMARY_FIELD)
        self.assertEqual([b["type"] for b in service.order],
                         ["welcome", "sermon", "sermon", "scripture"])
        self.assertEqual(service.order[3]["reference"], "John 3:16")
        path.unlink()

    def test_a_file_with_no_order_is_rejected(self):
        import tempfile

        with tempfile.NamedTemporaryFile("w", suffix=".yaml", delete=False) as handle:
            handle.write("service: {date: 2026-09-06}\n")
            path = Path(handle.name)
        with self.assertRaises(ServiceError):
            load(path, KNOWN_TYPES, PRIMARY_FIELD)
        path.unlink()


class EndToEnd(unittest.TestCase):
    def setUp(self):
        self.service = load(ROOT / "services" / "2026-09-06.yaml", KNOWN_TYPES, PRIMARY_FIELD)
        self.theme = Theme.load(ROOT / "theme.yaml")
        self.pages, self.warnings = build_pages(
            self.service, self.theme, ROOT / "library"
        )

    def test_the_example_service_builds_cleanly(self):
        self.assertGreater(len(self.pages), 30)
        self.assertEqual(self.service.warnings + self.warnings, [])

    def test_every_hymn_stanza_survives_into_the_deck(self):
        hymns = [b for b in self.service.order if b["type"] == "hymn"]
        self.assertTrue(hymns)
        rendered = words(
            " ".join(
                line.text
                for page in self.pages
                for line in page.lines
            )
        )
        for hymn in hymns:
            for stanza in hymn["stanzas"]:
                for word in words(stanza):
                    self.assertIn(word, rendered)

    def test_each_stanza_gets_its_own_slide(self):
        hymn = next(
            b for b in self.service.order
            if b["type"] == "hymn" and b.get("number") == 57
        )
        stanza_pages = [
            p for p in self.pages
            if p.meta.get("element") == "hymn" and p.header.startswith("UMH 57 ")
        ]
        self.assertEqual(len(stanza_pages), len(hymn["stanzas"]))

    def test_communion_sunday_carries_the_communion_slides(self):
        self.assertTrue(self.service.communion)
        self.assertTrue(
            any(p.meta.get("element") == "communion" for p in self.pages)
        )

    def test_the_flower_dedication_reaches_a_slide(self):
        text = " ".join(
            line.text for p in self.pages
            if p.meta.get("element") == "flowers" for line in p.lines
        )
        self.assertIn("Whitfield", text)

    def test_every_announcement_gets_a_slide(self):
        pages = [p for p in self.pages if p.meta.get("element") == "announcements"]
        self.assertEqual(len(pages), len(self.service.announcements))


class Linting(unittest.TestCase):
    def _service(self, body: str):
        import tempfile

        with tempfile.NamedTemporaryFile("w", suffix=".yaml", delete=False) as handle:
            handle.write(body)
            path = Path(handle.name)
        service = load(path, KNOWN_TYPES, PRIMARY_FIELD)
        path.unlink()
        return service

    def test_communion_flag_without_a_communion_slide_warns(self):
        service = self._service(
            "service: {date: 2026-09-06, communion: true}\norder: [welcome]\n"
        )
        self.assertTrue(any("communion" in w for w in service.warnings))

    def test_unwritten_announcements_warn(self):
        service = self._service(
            "service: {date: 2026-09-06}\n"
            "announcements: [{title: Rally Day}]\n"
            "order: [welcome]\n"
        )
        self.assertTrue(any("announcement" in w for w in service.warnings))

    def test_a_hymn_with_no_copyright_line_warns(self):
        service = self._service(
            "service: {date: 2026-09-06}\n"
            "order:\n  - hymn: {number: 1, title: Test, stanzas: ['a']}\n"
        )
        self.assertTrue(any("copyright" in w for w in service.warnings))


if __name__ == "__main__":
    unittest.main()
