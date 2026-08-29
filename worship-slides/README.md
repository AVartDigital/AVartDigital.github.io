# Weekly worship slides

Turns one plain-text file into Sunday's PowerPoint deck.

The idea is that the only thing that changes week to week is a short YAML file
describing that Sunday's service. Everything else — the look of the slides, the
Lord's Prayer, the creeds, the communion responses, where text breaks across
slides — is decided once and reused.

```bash
pip install -r requirements.txt

cp services/TEMPLATE.yaml services/2026-09-13.yaml
# fill it in from the pastor's liturgy, the flower chart, the announcements

python build.py services/2026-09-13.yaml --check   # read it through, no deck yet
python build.py services/2026-09-13.yaml           # write the .pptx
```

Three files land in `out/`:

| File | What it's for |
| --- | --- |
| `2026-09-13-worship.pptx` | the deck, ready to open in PowerPoint |
| `2026-09-13-proof.txt` | every slide as plain text — proofread on your phone |
| `2026-09-13-songs.csv` | song usage, for CCLI / OneLicense reporting |

Run `services/2026-09-06.yaml` to see a full communion Sunday worked through.

## What it handles for you

**Text that doesn't fit.** Give it a whole prayer and it works out how many
slides that is. It breaks at paragraph boundaries first, shrinks the font by a
couple of points if that saves a slide, and only ever splits mid-paragraph when
there's no other option. It will not shrink text past `max_shrink_pt` to avoid a
split — a wall of small text is worse than two slides.

**Responsive readings.** Lines beginning `L:` or `P:` (also `Leader:`,
`People:`, `All:`, `One:`, `Many:`) are detected automatically. The
congregation's parts are set in bold, the labels sit in their own gutter, and a
slide never ends on the leader's line with the response overleaf.

**Hymns.** One stanza per slide by default, with the hymnal number and title in
the header and the copyright line in the footer. Add `pack: true` to a hymn to
group stanzas instead.

**Flower dedications.** Fill in whichever of `given_by`, `in_memory_of`,
`in_honor_of`, `in_celebration_of`, `in_thanksgiving_for` apply and it writes
the sentence.

**Mistakes you'd otherwise find on Sunday morning.** `--check` warns when
`communion: true` but no communion element is in the order, when announcements
are written but never shown, when a hymn has no copyright line, and so on.

## Elements

Write each entry in the `order:` list in whichever of these shapes suits it:

```yaml
order:
  - welcome                          # nothing more to say
  - scripture: John 3:16             # one value
  - hymn: {number: 57, title: "..."} # a block
  - type: hymn                       # or spelled out
    number: 57
```

| Element | Notes |
| --- | --- |
| `hymn`, `song` | `hymnal`, `number`, `title`, `stanzas:`, `copyright`, `ccli`, `onelicense` |
| `scripture` | `reference`, `translation`, `text` |
| `sermon` | `title`, `preacher` |
| `prelude` `postlude` `offertory` `anthem` `special_music` `solo` `handbells` `music` | `title`, `composer`, `performer` |
| `call_to_worship` `opening_prayer` `prayer` `prayer_of_confession` `assurance` `affirmation_of_faith` `pastoral_prayer` `invitation` `offering` `prayer_of_dedication` `benediction` `sending_forth` `responsive` `text` `liturgy` | `text:`, optional `source:` |
| `lords_prayer` `apostles_creed` `nicene_creed` `doxology` `gloria_patri` `communion` `passing_the_peace` | pulled from `library/` |
| `flowers`, `announcements` | filled from the blocks at the top of the file |
| `welcome` `greeting` `children` `joys_and_concerns` `silence` | a single heading slide |
| `section` | a divider, e.g. `{title: "Holy Communion"}` |
| `blank` | black slide |
| `image` | `path`, optional `caption` |
| `include` | any other file in `library/`, by name |

Anything unrecognized still renders as a plain text slide, with a warning.

## Changing the look

Everything visual lives in `theme.yaml` — colors, fonts, sizes, margins. The
defaults are light text on near-black, which is what reads best on a projector
in a lit sanctuary.

If text overflows a slide or breaks earlier than it needs to, the one value to
adjust is `layout.char_width_ratio`. It's the assumed average character width as
a fraction of the font size. Raise it if text overflows; lower it if slides
break too early.

## Adding to the library

`library/` holds anything said most weeks. Each file is a `title`, a `header`,
a `copyright` line and the `text`. Add a file, then use it in a service with
`- include: {file: name-without-extension}`.

`library/communion.yaml` deliberately contains only the congregation's
responses. The pastor's portions of the Great Thanksgiving are spoken from the
table, and the UMPH text of *A Service of Word and Table* is under copyright —
if your pastor wants those projected, paste them in from the church's licensed
copy and add the credit to `copyright:`.

## Copyright and reporting

Every hymn and song can carry `copyright`, `ccli`, `onelicense` and `license`
fields. Whatever you put there is printed small at the foot of each slide of
that song, and collected into `out/<date>-songs.csv` so the quarterly CCLI or
OneLicense report is a matter of concatenating the CSVs rather than
reconstructing the year from memory. `--check` warns about any song missing a
copyright line.

## Tests

```bash
python -m unittest discover -s tests
```

They cover the parts where a bug would show up on the screen in front of the
congregation: where text breaks, whether any words get dropped, whether a
leader's line can end up stranded from its response.
