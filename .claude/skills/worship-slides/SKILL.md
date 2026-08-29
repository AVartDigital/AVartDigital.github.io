---
name: worship-slides
description: Build Sunday's worship slide deck for Simsbury UMC from the pastor's liturgy, the flower chart, and the week's announcements. Use whenever the user pastes an order of worship, a liturgy, a bulletin, hymn numbers, a flower dedication, or announcements and wants slides, a PowerPoint, or a deck for a service. Also use for editing or re-running a service already in worship-slides/services/.
---

# Weekly worship slides

The generator lives in `worship-slides/`. Read its `README.md` for the full
element list. Your job each week is to turn what the user pastes in — liturgy,
hymn numbers, flower dedication, announcements — into one service file, build
it, and hand back the deck plus anything that needs a human decision.

## The weekly pass

1. **Start from the template.** Copy `worship-slides/services/TEMPLATE.yaml` to
   `worship-slides/services/YYYY-MM-DD.yaml` for the coming Sunday. If a file
   for that date already exists, edit it rather than starting over.

2. **Transcribe, don't rewrite.** The liturgy is the pastor's text. Copy it
   across exactly — wording, punctuation, line breaks, capitalization. Line
   breaks matter: they are where the text wants to break on screen, and the
   generator honors them. Never smooth out phrasing, modernize a word, or
   "fix" grammar in liturgy, scripture, or hymn text.

3. **Mark the responsive parts.** Put `L:` on the leader's lines and `P:` on
   the congregation's. If the source uses other labels (`One:`/`Many:`,
   `Pastor:`/`People:`) keep those — they are recognized too. Anything the
   congregation reads together belongs on a `P:` line so it renders in bold.

4. **Use the library.** The Lord's Prayer, the creeds, the doxology, the
   Gloria Patri, the peace, and the communion responses are already in
   `worship-slides/library/`. Reference them (`- lords_prayer`) instead of
   pasting the words in again. If the pastor's version differs from the
   library copy, say so rather than silently using either one.

5. **Fill in the top blocks.** `flowers:` from the flower chart — use whichever
   of `given_by` / `in_memory_of` / `in_honor_of` / `in_celebration_of` /
   `in_thanksgiving_for` the dedication actually says, and let the generator
   write the sentence. `announcements:` one entry each, with `when` and `where`
   split out from the body when they are stated.

6. **Communion.** Set `service.communion: true` and add a
   `- section: {title: "Holy Communion"}` divider followed by `- communion`.
   Only the congregation's responses are projected.

7. **Copyright.** Every hymn needs a `copyright:` line. Public domain hymns
   (roughly anything written before 1929 — most of Wesley, Newton, Watts,
   Fawcett) can say `"Public Domain"` with the author and date. For anything
   under copyright, ask the user for the CCLI or OneLicense number rather than
   guessing one, and put it in `ccli:` or `onelicense:`.

8. **Build and read it back.**

   ```bash
   cd worship-slides
   python build.py services/YYYY-MM-DD.yaml
   ```

   Then read `out/YYYY-MM-DD-proof.txt` yourself before handing anything over.
   You are checking for text that got split in an awkward place, a stanza that
   landed on two slides, a responsive exchange that came apart. Fix the service
   file and rebuild; don't hand over a deck you haven't read.

9. **Report what needs a person.** Pass on every warning the build printed, and
   anything you had to guess at: a hymn number you couldn't confirm, a
   scripture translation that wasn't stated, an announcement with no date, a
   name whose spelling you're unsure of. Say plainly what you assumed.

## What not to do

- Don't invent liturgy, prayers, or hymn stanzas. If the user gives you three
  stanzas, the deck gets three stanzas. If text is missing, ask for it — a hymn
  with no `stanzas:` renders as a cue slide pointing at the hymnal, which is a
  reasonable fallback, but say that's what you did.
- Don't reproduce copyrighted text you were not given. That includes the
  pastor's portions of the UMPH Great Thanksgiving and hymn lyrics still under
  copyright.
- Don't change `theme.yaml` as part of a weekly build. That's a deliberate,
  separate decision about how every service looks.
- Don't correct the spelling of a person's name in a dedication or
  announcement. Flag it and let the user decide.

## Other things the user may ask for

- **A different look** — edit `theme.yaml`, rebuild, and show the result. If
  text starts overflowing, `layout.char_width_ratio` is the value to adjust.
- **A new reusable text** — add a file to `library/` in the same shape as the
  others, with a `copyright:` line.
- **CCLI / OneLicense reporting** — the per-service CSVs in `out/` concatenate
  into a period report.
