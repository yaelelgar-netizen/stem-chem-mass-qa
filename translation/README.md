# Translation export — לומדת נפח (STEM Chemistry 1: Volume)

Hebrew → Arabic translation export, built the same way as the Murals unit's
export: everything a professional translator needs lives in one Word file,
IDs stay stable so the Arabic answers can be imported back later, and
nothing here touches the learner-facing unit itself.

## For the translator

Open [`export/chem1vol_translation_he-ar.docx`](export/chem1vol_translation_he-ar.docx)
and fill in the "Arabic translation" column only. Full instructions are on
its cover page.

## Files

```
translation/
  export/
    chem1vol_translation_he-ar.docx     — hand this to the translator
    chem1vol_translation_manifest.json  — machine-readable source of truth (ID ↔ Hebrew ↔ Arabic)
    asset_localization_report.json      — the one PNG with Hebrew text baked into the graphic (not translatable as text)
  tools/
    extract_translations.py             — index.html + the 3 applets → manifest JSON
    build_docx.js                       — manifest JSON → DOCX
    asset_localization_report.py        — writes the asset report (hand-maintained list, see file docstring)
    verify_coverage.py                  — independent sweep: any learner-facing Hebrew NOT in the manifest?
```

373 translatable strings across 29 screens, global nav chrome, and the
three embedded lab applets (calibration, displacement, floating-body).

## Regenerating after the Hebrew source changes

```bash
python3 translation/tools/extract_translations.py
python3 translation/tools/verify_coverage.py      # should report 0 unmatched fragments
cd translation/tools && npm install docx && cd ../..    # first time only
node translation/tools/build_docx.js
```

IDs (e.g. `CHEM1VOL-S20-OPT-02`) are stable across regeneration: an entry
keeps its ID and any Arabic translation already in the manifest as long as
its (screen, type, Hebrew source) is unchanged. If a string changes or is
removed, its old entry moves to `orphaned` in the manifest instead of being
deleted, so an in-progress translation is never silently lost — review that
list by hand after regenerating.

`asset_localization_report.json` is **not** auto-derived from the HTML —
it's a short, hand-maintained list (currently just `check-button.png`,
the reusable "?צדקתי" submit-button graphic used across 10 question
screens). This project's convention keeps all other content text as live
HTML rather than baking it into images, specifically so it doesn't need a
report entry — if that ever changes for a new asset, add it to the
`ASSETS` list in `asset_localization_report.py` by hand.

## What's covered

- All 29 screens: questions, instructions, dialogue, drag/drop pieces,
  table cells, feedback text (read from the `data-fb-correct` /
  `data-fb-incorrect` attributes, since the visible feedback paragraphs
  are empty in the markup until JavaScript fills them in), and the video
  captions on screens with a clip (read live from `.vcap-src`, since this
  project keeps captions as on-screen HTML rather than a separate subtitle
  file).
- Global navigation chrome (the app's `aria-label`s on the forward/back
  buttons and the main stage) that lives outside any single screen.
- The three embedded lab applets, extracted as real DOM (they're plain
  HTML, not JSX) plus a scan of their `<script>` blocks for Hebrew text
  set dynamically at runtime — including breaking apart any HTML-template
  string (e.g. a table-row template) into its individual translatable
  phrases, so a translator is never shown raw markup to edit.
- `verify_coverage.py` currently reports 0 unmatched fragments across
  `index.html` and all three applets.
