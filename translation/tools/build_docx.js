/**
 * build_docx.js — לומדת נפח (STEM Chem 1 — Volume) translation export DOCX
 *
 * Reads translation/export/chem2mass_translation_manifest.json and
 * asset_localization_report.json, writes
 * translation/export/chem2mass_translation_he-ar.docx.
 *
 * Regenerate after editing extract_translations.py or re-running it:
 *   node translation/tools/build_docx.js
 */
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, WidthType, ShadingType, VerticalAlign,
} = require("docx");

const ROOT = path.resolve(__dirname, "..", "..");
const EXPORT_DIR = path.join(ROOT, "translation", "export");
const manifest = JSON.parse(fs.readFileSync(path.join(EXPORT_DIR, "chem2mass_translation_manifest.json"), "utf-8"));
const assetReport = JSON.parse(fs.readFileSync(path.join(EXPORT_DIR, "asset_localization_report.json"), "utf-8"));

// screens 1..29, in the order a learner sees them, followed by the three
// embedded applets (shared across several screens, so listed once at the end)
const SCREEN_ORDER = ["GLOBAL"].concat(Array.from({ length: 29 }, (_, i) => `screen-${i + 1}`)).concat(["APPLETS"]);

const COMPONENT_LABELS = {
  "content": "Content screen — always unlocked",
  "question": "Question screen",
  "video": "Video screen — Continue (►) stays locked until the clip ends",
  "global chrome": "App-wide navigation chrome (outside any single screen)",
};

const TYPE_GLOSSARY = [
  ["question / instruction / sentence-stem", "The question prompt, task instructions, or the fixed part of a fill-in-the-blank sentence around a dropdown/blank"],
  ["option", "One answer choice (multiple-choice or a fill-in dropdown option)"],
  ["drag-card / fixed-step / step-label", "Drag-and-drop pieces, a fixed (non-draggable) step, or a numbered step label in a sequencing question"],
  ["dialogue", "Speech-bubble dialogue between Gal and Shira"],
  ["video-caption", "On-screen synced caption text for a video clip (this project keeps captions as live HTML, not a separate subtitle file) — the note gives the timestamp so Arabic timing can be checked against the clip"],
  ["feedback / feedback-correct / feedback-incorrect", "Feedback shown after submitting an answer. A single 'feedback' row means the same text is shown either way; separate correct/incorrect rows mean the wording differs"],
  ["table-header / table-cell", "Text in a results/report table"],
  ["equation", "A math/volume formula line (e.g. containing +, =, or unit labels)"],
  ["nav-button / submit-button / applet-button / play-button / close-button / button", "Button label (visible text or screen-reader aria-label)"],
  ["aria-label / image-alt-text / placeholder", "Accessibility text — read by screen readers, not usually visible"],
  ["callout / popup-title / popup-text / label / narration / title / text / ui-text", "Other on-screen text: callout boxes, popups, small labels, or applet UI (the three embedded lab applets: calibration, displacement, floating-body)"],
];

function groupBy(arr, keyFn) {
  const m = new Map();
  for (const item of arr) {
    const k = keyFn(item);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(item);
  }
  return m;
}

const byScreen = groupBy(manifest.entries, (e) => e.screen);

function heCell(text, { bold = false, size = 22, color } = {}) {
  return new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.RIGHT,
    children: [new TextRun({ text: text || "", rightToLeft: true, bold, size, color, font: "Arial" })],
  });
}

function enCell(text, { bold = false, size = 20, italics = false, color } = {}) {
  return new Paragraph({
    alignment: AlignmentType.LEFT,
    children: [new TextRun({ text: text || "", bold, italics, size, color, font: "Arial" })],
  });
}

function cell(children, { width, shading, valign = VerticalAlign.CENTER } = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: valign,
    shading: shading ? { type: ShadingType.CLEAR, fill: shading } : undefined,
    margins: { top: 80, bottom: 80, left: 100, right: 100 },
    children: Array.isArray(children) ? children : [children],
  });
}

const COL_ID = 1700, COL_TYPE = 1300, COL_HE = 3060, COL_AR = 2966;
const HEADER_FILL = "1B5E6B"; // deep teal — distinct from the murals-project green, evokes water/volume without copying any brand color
const ALT_FILL = "F2F2F2";

function bilingualHeaderCell(nativeText, englishGloss, width) {
  // Two separate paragraphs, each internally single-direction, instead of one
  // run mixing Hebrew/Arabic + English — a single mixed-direction run lets the
  // Unicode bidi algorithm reorder the two scripts unpredictably.
  return cell(
    [
      heCell(nativeText, { bold: true, color: "FFFFFF" }),
      enCell(englishGloss, { bold: true, color: "FFFFFF", size: 16 }),
    ],
    { width, shading: HEADER_FILL }
  );
}

function screenTable(entries) {
  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      cell(enCell("ID", { bold: true, color: "FFFFFF" }), { width: COL_ID, shading: HEADER_FILL }),
      cell(enCell("Type", { bold: true, color: "FFFFFF" }), { width: COL_TYPE, shading: HEADER_FILL }),
      bilingualHeaderCell("עברית (מקור)", "Hebrew source", COL_HE),
      bilingualHeaderCell("العربية (ترجمة)", "Arabic translation", COL_AR),
    ],
  });

  const rows = entries.map((e, i) => {
    const fill = i % 2 === 1 ? ALT_FILL : undefined;
    const heChildren = [heCell(e.source)];
    if (e.note) {
      heChildren.push(enCell(`⚠ Translator note: ${e.note}`, { italics: true, size: 16, color: "9C4221" }));
    }
    return new TableRow({
      children: [
        cell(enCell(e.id, { size: 16 }), { width: COL_ID, shading: fill }),
        cell(enCell(e.type, { size: 18 }), { width: COL_TYPE, shading: fill }),
        cell(heChildren, { width: COL_HE, shading: fill }),
        cell(heCell(e.translation || ""), { width: COL_AR, shading: fill }),
      ],
    });
  });

  return new Table({
    width: { size: COL_ID + COL_TYPE + COL_HE + COL_AR, type: WidthType.DXA },
    columnWidths: [COL_ID, COL_TYPE, COL_HE, COL_AR],
    rows: [headerRow, ...rows],
  });
}

function screenSection(screenId, entries) {
  const idx = entries[0].screenIndex;
  const label = entries[0].screenLabel;
  const component = entries[0].component;
  const componentLabel = COMPONENT_LABELS[component] || component;
  const heading = screenId === "APPLETS"
    ? "EMBEDDED APPLETS — calibration.html / displacement.html / floating-body.html"
    : screenId === "GLOBAL"
    ? "GLOBAL — App-wide navigation chrome"
    : `SCREEN ${idx} — ${screenId.toUpperCase()}`;

  return [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      pageBreakBefore: true,
      children: [new TextRun({ text: heading })],
    }),
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.RIGHT,
      spacing: { after: 80 },
      children: [new TextRun({ text: label, rightToLeft: true, italics: true, size: 22, font: "Arial" })],
    }),
    new Paragraph({
      spacing: { after: 200 },
      children: [new TextRun({ text: componentLabel, italics: true, size: 20, color: "555555" })],
    }),
    screenTable(entries),
    new Paragraph({ text: "", spacing: { after: 100 } }),
  ];
}

function coverPage() {
  const total = manifest.entries.length;
  const screens = new Set(manifest.entries.map((e) => e.screen)).size;
  return [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { before: 1200, after: 200 },
      children: [new TextRun({ text: "לומדת נפח — STEM Chemistry 1: Volume" })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      children: [new TextRun({ text: "Translation Export — Hebrew → Arabic", size: 32, bold: true })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [new TextRun({ text: "כימיה 1 — נפח | כיתות ז׳-ח׳", rightToLeft: true, size: 24 })],
    }),
    new Paragraph({ text: "", spacing: { after: 400 } }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `${total} translatable strings across ${screens} screens/components`, size: 22 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 600 },
      children: [new TextRun({
        text: "Source: index.html + applets/calibration.html + applets/displacement.html + applets/floating-body.html — no learner-facing file was modified to produce this export.",
        size: 18, italics: true, color: "555555",
      })],
    }),
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("How to use this document")] }),
    ...[
      "This document is grouped by screen, in the order a learner sees them (SCREEN 1 → SCREEN 29), followed by the three shared lab applets used inside several screens.",
      "Each row has a stable ID (e.g. CHEM1VOL-S20-OPT-02) — please keep the ID column untouched. It is how the Arabic translation gets matched back to the right place in the code; the Hebrew wording is never used as a lookup key.",
      "Please translate only the \"Arabic translation\" column. Leave every other column exactly as-is.",
      "A few rows carry a ⚠ translator note (in italics, under the Hebrew text) — these flag video-caption timing, or a table-template string where only the phrase is shown (the surrounding table markup is not part of the translation). Read these before translating that row.",
      "This workbook covers on-screen and screen-reader text only. A separate list — \"Asset Localization Report\" (last section of this document) — covers the one reusable button graphic with Hebrew text baked into the image (\"?צדקתי\"), which needs a fresh graphic export rather than a text translation. This project otherwise keeps all question/dialogue/instruction text as live HTML specifically so it never needs to be baked into an image.",
      "RTL note: both Hebrew and Arabic columns are already set to right-to-left paragraph direction, so Arabic typed into the translation column should align and read correctly without extra formatting.",
    ].map((t) => new Paragraph({ spacing: { after: 120 }, bullet: { level: 0 }, children: [new TextRun({ text: t, size: 20 })] })),
    new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 300 }, children: [new TextRun("Type column glossary")] }),
    ...TYPE_GLOSSARY.map(([types, desc]) => new Paragraph({
      spacing: { after: 80 },
      children: [
        new TextRun({ text: types + ":  ", bold: true, size: 20 }),
        new TextRun({ text: desc, size: 20 }),
      ],
    })),
  ];
}

function assetAppendix() {
  const assets = assetReport.assets;
  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      cell(enCell("Image file", { bold: true, color: "FFFFFF" }), { width: 2400, shading: HEADER_FILL }),
      cell(heCell("Baked-in Hebrew text", { bold: true, color: "FFFFFF" }), { width: 2200, shading: HEADER_FILL }),
      cell(enCell("Used in screen(s)", { bold: true, color: "FFFFFF" }), { width: 2400, shading: HEADER_FILL }),
      cell(enCell("Note", { bold: true, color: "FFFFFF" }), { width: 2026, shading: HEADER_FILL }),
    ],
  });
  const rows = assets.map((a, i) => {
    const fill = i % 2 === 1 ? ALT_FILL : undefined;
    return new TableRow({
      children: [
        cell(enCell(a.file, { size: 18 }), { width: 2400, shading: fill }),
        cell(heCell(a.bakedText), { width: 2200, shading: fill }),
        cell(enCell(a.usedInScreens.join(", "), { size: 16 }), { width: 2400, shading: fill }),
        cell(enCell(a.note, { size: 16 }), { width: 2026, shading: fill }),
      ],
    });
  });
  return [
    new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new TextRun("Appendix A — Assets requiring localization")] }),
    new Paragraph({
      spacing: { after: 200 },
      children: [new TextRun({
        text: "This image has Hebrew text baked into the graphic itself (not translatable as text). "
          + "It needs one fresh Arabic export to replace everywhere it's used. "
          + assetReport.meta.method,
        size: 20,
      })],
    }),
    new Table({
      width: { size: 2400 + 2200 + 2400 + 2026, type: WidthType.DXA },
      columnWidths: [2400, 2200, 2400, 2026],
      rows: [headerRow, ...rows],
    }),
  ];
}

function regenAppendix() {
  return [
    new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new TextRun("Appendix B — Regenerating this export")] }),
    new Paragraph({
      spacing: { after: 120 },
      children: [new TextRun({ text: "If the Hebrew source (index.html or any of the three applets) changes, regenerate everything with:", size: 20 })],
    }),
    new Paragraph({
      spacing: { after: 120 },
      children: [new TextRun({ text: "python3 translation/tools/extract_translations.py", font: "Courier New", size: 20 })],
    }),
    new Paragraph({
      spacing: { after: 200 },
      children: [new TextRun({ text: "node translation/tools/build_docx.js", font: "Courier New", size: 20 })],
    }),
    ...[
      "IDs are stable across regeneration: an entry keeps its ID as long as (screen, type, Hebrew source text) is unchanged, and any Arabic translation already entered in the manifest JSON carries forward automatically.",
      "If a string's Hebrew wording changes or it's removed from the source, its old entry moves to an \"orphaned\" list inside chem2mass_translation_manifest.json instead of being deleted — so an in-progress Arabic translation is never silently lost. Review that list by hand after each regeneration.",
      "translation/tools/verify_coverage.py runs an independent sweep for any learner-facing Hebrew text left outside the manifest — run it after any extraction-logic change.",
      "translation/tools/asset_localization_report.py rebuilds Appendix A from a hand-maintained list — there is no reliable way to auto-detect baked-in image text, so re-review new/changed images by eye and update that script's ASSETS list.",
    ].map((t) => new Paragraph({ spacing: { after: 120 }, bullet: { level: 0 }, children: [new TextRun({ text: t, size: 20 })] })),
  ];
}

const children = [
  ...coverPage(),
];

for (const screenId of SCREEN_ORDER) {
  const entries = byScreen.get(screenId);
  if (!entries || entries.length === 0) continue;
  children.push(...screenSection(screenId, entries));
}

children.push(...assetAppendix());
children.push(...regenAppendix());

const doc = new Document({
  sections: [{ properties: {}, children }],
  styles: {
    default: {
      document: { run: { font: "Arial", size: 20 } },
    },
  },
});

Packer.toBuffer(doc).then((buf) => {
  const out = path.join(EXPORT_DIR, "chem2mass_translation_he-ar.docx");
  fs.writeFileSync(out, buf);
  console.log("Wrote", out);
});
