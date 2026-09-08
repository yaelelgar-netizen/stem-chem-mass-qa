#!/usr/bin/env python3
"""
extract_translations.py — לומדת נפח (STEM Chem 1 — Volume) translation export

Extracts learner-facing Hebrew text from index.html + the three embedded
applets (applets/calibration.html, applets/displacement.html,
applets/floating-body.html) into a stable, machine-readable manifest for
professional Arabic translation. Same method/shape as the Murals (720
WallPaint) translation export: one Word doc with stable IDs a translator
fills in, plus the manifest.json as the machine-readable source of truth.

Usage:
    python3 translation/tools/extract_translations.py

Regenerate any time the Hebrew source (index.html or an applet) changes.
IDs are stable across regeneration: if an existing manifest is found at
translation/export/chem2mass_translation_manifest.json, matching entries
(same screen + type + Hebrew source text) keep their ID and any Arabic
translation already entered. Entries whose source text changed or
disappeared are moved to "orphaned" instead of being silently deleted.

Does NOT touch any learner-facing file. Read-only against the project;
only writes into translation/export/.
"""
import json
import re
import sys
from pathlib import Path
from bs4 import BeautifulSoup, NavigableString, Comment

ROOT = Path(__file__).resolve().parents[2]
INDEX_HTML = ROOT / "index.html"
APPLETS = [
    ROOT / "applets" / "gravity-rock-drop" / "index.html",
    ROOT / "applets" / "gravity-scale-lab" / "index.html",
]
EXPORT_DIR = ROOT / "translation" / "export"
MANIFEST_PATH = EXPORT_DIR / "chem2mass_translation_manifest.json"

HEBREW_RE = re.compile(r"[֐-׿]")
WS_RE = re.compile(r"\s+")

INLINE_FORMAT_TAGS = {"strong", "b", "em", "i", "sup", "sub", "u", "wbr", "br"}
# classes of <span> used purely for inline styling within one sentence
# (e.g. the bold "+"/"=" operators inside the volume equation on screen 8) —
# treated like INLINE_FORMAT_TAGS so the whole line is captured as one unit
# instead of fragmenting per span.
INLINE_FORMAT_CLASSES = {"k", "b"}

PROSE_CONTAINER_TAGS = {"p", "li", "td", "th", "div"}
INLINE_PHRASING_TAGS = {"span", "a"}

# elements that must never be exported even if they contain Hebrew
EXCLUDED_IDS = set()

# screen labels, taken verbatim from dev_index.html's own SCREENS list
# (the single place this project already keeps a human label per screen)
SCREEN_LABELS = {
    1: "סרטון פתיחה (שקפים 2-3)",
    2: "חקר דגימות (4 דגימות)",
    3: "יישומון כבידה",
    4: "דיאלוג: גל ← שירה",
    5: "שאלה 1 · תפריטים נפתחים",
    6: "דיאלוג + קלפי מכשירים",
    7: "מד כוח (מסך אופציונלי)",
    8: "דיאלוג + יישומון מאזניים",
    9: "שאלה 2 · רב-בחירה",
    10: "סרטון 2 (שקף 15)",
    11: "דוח נתונים · אנורתוזיט",
    12: "דיאלוג: גל ← שירה",
    13: "שאלה 3 · תפריטים נפתחים",
    14: "דוח נתונים · בזלת מארה",
    15: "סצנה: אבקת רגולית",
    16: "שאלה 4 · חד-ברירה",
    17: "דוח נתונים · רגולית",
    18: "דיאלוג: גרגר בודד",
    19: "שאלה 5 · חד-ברירה",
    20: "סרטון 3 (שקף 28)",
    21: "דוח מדידות · תוצאה חריגה",
    22: "שאלה 6 · חד-ברירה",
    23: "דוח נתונים · מלא",
    24: "דיאלוג: שלושה מיכלי גז",
    25: "שאלה 7 · טבלת נתונים",
    26: "דיאלוג + מסגרות מהבהבות",
    27: "שאלה 8 · חד-ברירה",
    28: "סיום",
}

TYPE_RULES = [
    # --- mass unit components (most specific first) ---
    ("stitle", "title"),
    ("slabel", "label"),
    ("sample__name", "label"),
    ("sample__info", "popup-text"),
    ("report__title", "table-header"),
    ("report__head", "table-header"),
    ("report__row", "table-cell"),
    ("dtable__cap", "table-header"),
    ("dtable", "table-cell"),
    ("hl-label", "label"),
    ("nametag", "label"),
    ("tabpanel", "popup-text"),
    ("gloss-tip", "popup-text"),
    ("gloss-link", "label"),
    ("video-cap", "video-caption"),
    ("chip", "label"),
    ("jump", "label"),
    ("tab", "label"),
    # (substring found in element's own class or ancestor class within screen, type)
    ("q-bold", "instruction"),
    ("qstem", "question"),
    ("qfill", "sentence-stem"),
    ("dcard", "drag-card"),
    ("dfixed", "fixed-step"),
    ("dhead", "table-header"),
    ("dstep", "step-label"),
    ("dlabel", "label"),
    ("bcap", "dialogue"),
    ("btext", "dialogue"),
    ("bubble__text", "dialogue"),
    ("callout", "callout"),
    ("mlabel", "label"),
    ("info-pop__title", "popup-title"),
    ("info-pop", "popup-text"),
    ("endcard__note", "label"),
    ("endcard", "label"),
    ("rp-h", "table-header"),
    ("rp-c", "table-cell"),
    ("rtitle", "table-header"),
    ("rhead", "table-header"),
    ("rcell", "table-cell"),
    ("eq", "equation"),
    ("methodbtn", "applet-button"),
    ("start-btn", "nav-button"),
    ("check-btn", "submit-button"),
    ("navbtn", "nav-button"),
    ("video-play", "play-button"),
    ("vc-", "aria-label"),
    ("modal__close", "close-button"),
    ("qprogress", "aria-label"),
    ("card__title", "label"),
    ("card__desc", "narration"),
    ("card__name", "label"),
    ("option", "option"),
]

ID_TAG_ABBREV = {
    "question": "Q",
    "instruction": "INSTR",
    "sentence-stem": "STEM",
    "drag-card": "CARD",
    "fixed-step": "FIXED",
    "table-header": "THEAD",
    "step-label": "STEP",
    "label": "LABEL",
    "dialogue": "DLG",
    "callout": "CALLOUT",
    "popup-title": "POPTITLE",
    "popup-text": "POPUP",
    "table-cell": "TCELL",
    "equation": "EQ",
    "applet-button": "APPBTN",
    "nav-button": "NAV",
    "submit-button": "SUBMIT",
    "play-button": "PLAY",
    "close-button": "CLOSE",
    "option": "OPT",
    "aria-label": "ARIA",
    "image-alt-text": "ALT",
    "placeholder": "PLACEHOLDER",
    "video-caption": "VCAP",
    "feedback": "FB",
    "feedback-correct": "FBCORR",
    "feedback-incorrect": "FBINCORR",
    "narration": "NARR",
    "text": "TEXT",
    "button": "BTN",
    "ui-text": "UI",
    "title": "TITLE",
}


def norm(text):
    return WS_RE.sub(" ", text).strip()


def has_hebrew(text):
    return bool(HEBREW_RE.search(text))


def is_inline_format(el):
    if not hasattr(el, "name"):
        return False
    if el.name in INLINE_FORMAT_TAGS:
        return True
    cls = el.get("class")
    if cls and any(c in INLINE_FORMAT_CLASSES for c in cls):
        return True
    return False


def classify_type(el, screen_root, default="text"):
    node = el
    while node is not None:
        cls = node.get("class") if hasattr(node, "get") else None
        if cls:
            joined = " ".join(cls)
            for needle, type_name in TYPE_RULES:
                if needle in joined:
                    return type_name
        if node is screen_root:
            break
        node = node.parent
    if default == "text" and getattr(el, "name", None) == "button":
        return "button"
    return default


def css_path(el, screen_root):
    parts = []
    node = el
    depth = 0
    while node is not None and depth < 6:
        if hasattr(node, "name") and node.name:
            seg = node.name
            if node.get("id"):
                seg += f"#{node.get('id')}"
            elif node.get("class"):
                seg += "." + ".".join(node.get("class")[:2])
            parts.append(seg)
        if node is screen_root:
            break
        node = node.parent
        depth += 1
    parts.reverse()
    locator = " > ".join(parts)
    line = getattr(el, "sourceline", None)
    if line:
        return f"line {line} · {locator}"
    return locator


def extract_leaves(el, screen_root, results, seen_ids):
    """Recursively find maximal text leaves containing Hebrew."""
    if not hasattr(el, "name") or el.name in ("script", "style", "template"):
        return
    if el.get("id") in EXCLUDED_IDS:
        return

    text = norm(el.get_text(separator=" ", strip=True))
    if not has_hebrew(text):
        return

    children = [c for c in el.find_all(True, recursive=False)]
    qualifying_children = [
        c for c in children
        if not is_inline_format(c)
        and c.get("id") not in EXCLUDED_IDS
        and has_hebrew(norm(c.get_text(separator=" ", strip=True)))
    ]

    # A prose-ish container with 2+ qualifying inline (span/a) children is
    # almost always one sentence split across styling runs — capture the
    # whole thing as one unit instead of fragmenting it per span.
    if (
        el.name in PROSE_CONTAINER_TAGS
        and len(qualifying_children) > 1
        and all(c.name in INLINE_PHRASING_TAGS for c in qualifying_children)
    ):
        key = id(el)
        if key not in seen_ids:
            seen_ids.add(key)
            results.append((el, text, "leaf"))
        return

    if qualifying_children:
        for c in children:
            extract_leaves(c, screen_root, results, seen_ids)
        direct = "".join(
            str(c) for c in el.contents
            if isinstance(c, NavigableString) and not isinstance(c, Comment)
        )
        direct = norm(direct)
        if has_hebrew(direct):
            key = (id(el), "leftover")
            if key not in seen_ids:
                seen_ids.add(key)
                results.append((el, direct, "leftover"))
        return

    key = id(el)
    if key not in seen_ids:
        seen_ids.add(key)
        results.append((el, text, "leaf"))


def extract_attributes(section, results, seen_attr_ids):
    for el in section.find_all(True):
        if el.name in ("script", "style", "template"):
            continue
        if el.get("id") in EXCLUDED_IDS:
            continue
        for attr in ("alt", "aria-label", "title", "placeholder"):
            val = el.get(attr)
            if not val:
                continue
            val = norm(val)
            if not has_hebrew(val):
                continue
            if attr == "alt":
                parent = el.parent
                hops = 0
                skip = False
                while parent is not None and hops < 3:
                    parent_label = parent.get("aria-label") if hasattr(parent, "get") else None
                    if parent_label and norm(parent_label) == val:
                        skip = True
                        break
                    parent = parent.parent
                    hops += 1
                if skip:
                    continue
            key = (id(el), attr)
            if key in seen_attr_ids:
                continue
            seen_attr_ids.add(key)
            attr_type = {
                "alt": "image-alt-text",
                "aria-label": "aria-label",
                "title": "aria-label",
                "placeholder": "placeholder",
            }[attr]
            results.append((el, val, attr_type))


def extract_feedback(smeta, screen_id, entries):
    """The correct/incorrect feedback shown after answering lives as
    data-fb-correct / data-fb-incorrect attributes on the .smeta element,
    not as static visible text — the visible <p class="feedback__body">
    is populated from these by script.js at runtime."""
    if smeta is None:
        return
    fb_correct = smeta.get("data-fb-correct")
    fb_incorrect = smeta.get("data-fb-incorrect")
    if not fb_correct and not fb_incorrect:
        return
    fb_correct = norm(fb_correct) if fb_correct else ""
    fb_incorrect = norm(fb_incorrect) if fb_incorrect else ""
    if fb_correct and fb_correct == fb_incorrect:
        entries.append({
            "_type": "feedback",
            "_source": fb_correct,
            "_locator": "attr:data-fb-correct/data-fb-incorrect on .smeta (identical — shown for both outcomes)",
        })
    else:
        if fb_correct:
            entries.append({"_type": "feedback-correct", "_source": fb_correct, "_locator": "attr:data-fb-correct on .smeta"})
        if fb_incorrect:
            entries.append({"_type": "feedback-incorrect", "_source": fb_incorrect, "_locator": "attr:data-fb-incorrect on .smeta"})


def extract_captions(section):
    """<div class="vcap-src"><span data-t="0.2">...</span>...</div> — synced
    video captions, live HTML text (not a separate SRT file)."""
    out = []
    for src in section.find_all("div", class_="vcap-src"):
        for span in src.find_all("span", attrs={"data-t": True}):
            text = norm(span.get_text(" ", strip=True))
            if not text:
                continue
            t = span.get("data-t")
            out.append((span, text, t))
    return out


def extract_screen(section):
    results = []
    seen_ids = set()
    seen_attr_ids = set()
    extract_leaves(section, section, results, seen_ids)
    extract_attributes(section, results, seen_attr_ids)
    return results


def build_screen_id(n):
    return f"screen-{n}"


def screen_component(section):
    smeta = section.find("div", class_="smeta")
    if smeta is None:
        return "content", None
    dtype = smeta.get("data-type") or "content"
    gate = smeta.get("data-gate")
    if dtype == "question":
        return "question", smeta
    if dtype == "video":
        return "video", smeta
    if gate:
        return f"content ({gate})", smeta
    return "content", smeta


def main():
    html = INDEX_HTML.read_text(encoding="utf-8")
    soup = BeautifulSoup(html, "html.parser")

    all_raw = []

    # global chrome that lives outside any .screen section (the app-wide
    # nav bar's forward/back buttons and the #app aria-label) — swept
    # separately since it is not nested in a data-screen element
    app_root = soup.find(id="app")
    if app_root:
        val = app_root.get("aria-label")
        if val and has_hebrew(val):
            all_raw.append({
                "screen": "GLOBAL", "screenIndex": -1, "component": "global chrome",
                "screenLabel": "כלי ניווט וממשק גלובליים (מחוץ למסכים עצמם)",
                "type": "aria-label", "source": norm(val), "sourceFile": "index.html",
                "sourceLocator": "#app[aria-label]", "note": "",
            })
    for btn_id in ("nav-fwd", "nav-back"):
        btn = soup.find(id=btn_id)
        if btn is None:
            continue
        val = btn.get("aria-label")
        if val and has_hebrew(val):
            all_raw.append({
                "screen": "GLOBAL", "screenIndex": -1, "component": "global chrome",
                "screenLabel": "כלי ניווט וממשק גלובליים (מחוץ למסכים עצמם)",
                "type": "aria-label", "source": norm(val), "sourceFile": "index.html",
                "sourceLocator": f"#{btn_id}[aria-label]", "note": "",
            })

    sections = soup.find_all("section", class_="screen")
    for section in sections:
        n = section.get("data-screen")
        if not n:
            continue
        n = int(n)
        screen_id = build_screen_id(n)
        label = SCREEN_LABELS.get(n, "")
        component, smeta = screen_component(section)

        # feedback (from data-fb-* attributes, not visible static text)
        fb_entries = []
        extract_feedback(smeta, screen_id, fb_entries)
        for fe in fb_entries:
            all_raw.append({
                "screen": screen_id,
                "screenIndex": n,
                "component": component,
                "screenLabel": label,
                "type": fe["_type"],
                "source": fe["_source"],
                "sourceFile": "index.html",
                "sourceLocator": fe["_locator"],
                "note": "",
            })

        # synced video captions
        for el, text, t in extract_captions(section):
            all_raw.append({
                "screen": screen_id,
                "screenIndex": n,
                "component": component,
                "screenLabel": label,
                "type": "video-caption",
                "source": text,
                "sourceFile": "index.html",
                "sourceLocator": css_path(el, section),
                "note": f"Synced caption — appears at {t}s into the clip. Keep the Arabic close to this length.",
            })

        # general DOM sweep
        items = extract_screen(section)
        for el, text, kind in items:
            attr_default = kind if kind in ("image-alt-text", "aria-label", "placeholder") else "text"
            type_name = classify_type(el, section, default=attr_default)
            all_raw.append({
                "screen": screen_id,
                "screenIndex": n,
                "component": component,
                "screenLabel": label,
                "type": type_name,
                "source": text,
                "sourceFile": "index.html",
                "sourceLocator": css_path(el, section),
                "note": "",
            })

    # ── applets (plain HTML/JS, real DOM — no JSX like Murals' React applet) ──
    for applet_path in APPLETS:
        all_raw.extend(extract_applet(applet_path))

    # ── de-dup exact duplicate (screen, type, source, sourceLocator) ──
    dedup = []
    seen = set()
    for e in all_raw:
        key = (e["screen"], e["type"], e["source"], e["sourceLocator"])
        if key in seen:
            continue
        seen.add(key)
        dedup.append(e)

    dedup.sort(key=lambda e: (e["screenIndex"],))

    manifest = assign_stable_ids(dedup)
    write_outputs(manifest)


def extract_applet(applet_path):
    if not applet_path.exists():
        return []
    name = applet_path.name
    html = applet_path.read_text(encoding="utf-8")
    soup = BeautifulSoup(html, "html.parser")
    results = []
    seen_ids = set()
    seen_attr_ids = set()
    body = soup.find("body") or soup
    extract_leaves(body, body, results, seen_ids)
    extract_attributes(body, results, seen_attr_ids)

    title_tag = soup.find("title")
    if title_tag and has_hebrew(title_tag.get_text()):
        results.append((title_tag, norm(title_tag.get_text()), "title"))

    entries = []
    for el, text, kind in results:
        attr_default = kind if kind in ("image-alt-text", "aria-label", "placeholder", "title") else "text"
        type_name = classify_type(el, body, default=attr_default)
        entries.append({
            "screen": "APPLETS",
            "screenIndex": 900,
            "component": f"applet ({name})",
            "screenLabel": "יישומונים משובצים (calibration / displacement / floating-body)",
            "type": type_name,
            "source": text,
            "sourceFile": f"applets/{name}",
            "sourceLocator": css_path(el, body),
            "note": "",
        })

    # Hebrew string literals inside <script> blocks (vanilla JS, not JSX —
    # dynamic labels/status text set at runtime, e.g. via textContent/innerText
    # or a small innerHTML template). Literals that themselves contain HTML
    # tags (e.g. an innerHTML table template) are parsed as mini-HTML and
    # split into their individual text runs, so a translator only ever sees
    # plain Hebrew phrases — never raw markup they could accidentally break.
    seen_literals = set()
    for script in soup.find_all("script"):
        code = script.string or ""
        if not code:
            continue
        for m in re.finditer(r"(['\"`])((?:(?!\1).)*[֐-׿](?:(?!\1).)*)\1", code):
            raw = m.group(2)
            if "<" in raw and ">" in raw:
                frag = BeautifulSoup(raw, "html.parser")
                sub_results = []
                sub_seen = set()
                extract_leaves(frag, frag, sub_results, sub_seen)
                for _el, sub_text, _kind in sub_results:
                    if not sub_text or len(sub_text) < 2:
                        continue
                    key = (name, sub_text)
                    if key in seen_literals:
                        continue
                    seen_literals.add(key)
                    entries.append({
                        "screen": "APPLETS",
                        "screenIndex": 900,
                        "component": f"applet ({name})",
                        "screenLabel": "יישומונים משובצים (calibration / displacement / floating-body)",
                        "type": "ui-text",
                        "source": sub_text,
                        "sourceFile": f"applets/{name}",
                        "sourceLocator": f"<script> HTML-template string literal near offset {m.start()} (one cell/label from that template)",
                        "note": "Set dynamically from JS as part of a small HTML template (e.g. a table row) — translate the phrase only, the surrounding tags are not shown here.",
                    })
                continue
            text = norm(raw)
            if not text or len(text) < 2:
                continue
            key = (name, text)
            if key in seen_literals:
                continue
            seen_literals.add(key)
            entries.append({
                "screen": "APPLETS",
                "screenIndex": 900,
                "component": f"applet ({name})",
                "screenLabel": "יישומונים משובצים (calibration / displacement / floating-body)",
                "type": "ui-text",
                "source": text,
                "sourceFile": f"applets/{name}",
                "sourceLocator": f"<script> string literal near offset {m.start()}",
                "note": "Set dynamically from JS (e.g. a status message or button label) — not in the static markup.",
            })
    return entries


def assign_stable_ids(dedup_entries):
    existing = {}
    orphan_candidates = {}
    if MANIFEST_PATH.exists():
        try:
            old = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
            for e in old.get("entries", []):
                key = (e["screen"], e["type"], e["source"])
                existing[key] = e
                orphan_candidates[key] = e
        except Exception as exc:
            print(f"WARNING: could not read existing manifest for ID stability: {exc}", file=sys.stderr)

    seq_counters = {}
    id_re = re.compile(r"^CHEM2MASS-(.+)-(\d+)$")
    for e in existing.values():
        m = id_re.match(e.get("id", ""))
        if m:
            seq_key = (e["screen"], e["type"])
            n = int(m.group(2))
            seq_counters[seq_key] = max(seq_counters.get(seq_key, 0), n)

    final_entries = []
    matched_keys = set()
    for e in dedup_entries:
        key = (e["screen"], e["type"], e["source"])
        if key in existing:
            old = existing[key]
            e["id"] = old["id"]
            e["translation"] = old.get("translation", "")
            if old.get("note") and not e.get("note"):
                e["note"] = old["note"]
            matched_keys.add(key)
        else:
            seq_key = (e["screen"], e["type"])
            seq_counters[seq_key] = seq_counters.get(seq_key, 0) + 1
            screen_tag = e["screen"].upper().replace("SCREEN-", "S")
            type_tag = ID_TAG_ABBREV.get(e["type"]) or re.sub(r"[^A-Z0-9]+", "", e["type"].upper()) or "TEXT"
            e["id"] = f"CHEM2MASS-{screen_tag}-{type_tag}-{seq_counters[seq_key]:02d}"
            e["translation"] = ""
        e["status"] = "active"
        final_entries.append(e)

    orphaned = [
        {**v, "status": "orphaned"}
        for k, v in orphan_candidates.items()
        if k not in matched_keys
    ]

    return {"entries": final_entries, "orphaned": orphaned}


def write_outputs(manifest):
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    out = {
        "meta": {
            "unit": "לומדת מסה — STEM כימיה 2, כיתה ז'",
            "sourceLanguage": "he",
            "targetLanguage": "ar",
            "generatedFrom": [
                "index.html",
                "applets/calibration.html",
                "applets/displacement.html",
                "applets/floating-body.html",
            ],
            "idScheme": "CHEM2MASS-{SCREEN}-{TYPE}-{SEQ}",
            "totalScreens": 28,
            "totalEntries": len(manifest["entries"]),
            "totalOrphaned": len(manifest["orphaned"]),
            "regenerate": "python3 translation/tools/extract_translations.py",
            "notes": (
                "IDs are stable across regeneration when (screen, type, Hebrew source) "
                "is unchanged. Entries removed or edited in the source move to "
                "'orphaned' instead of being deleted, so in-progress Arabic "
                "translations are never silently lost — review 'orphaned' after "
                "each regeneration and re-merge manually if the text just moved. "
                "Video captions (type 'video-caption') are read directly from the "
                "live HTML (div.vcap-src), not a separate SRT file, since this "
                "project keeps all narration text on-screen and translatable. "
                "Feedback rows (type 'feedback' / 'feedback-correct' / "
                "'feedback-incorrect') are read from the data-fb-correct / "
                "data-fb-incorrect attributes on each question's .smeta element, "
                "which is where script.js sources the feedback text at runtime — "
                "not from static visible HTML, since the feedback text is empty "
                "in the markup until JS fills it in."
            ),
        },
        "entries": [{k: v for k, v in e.items() if not k.startswith("_")} for e in manifest["entries"]],
        "orphaned": manifest["orphaned"],
    }
    MANIFEST_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {MANIFEST_PATH} — {len(out['entries'])} entries, {len(out['orphaned'])} orphaned")


if __name__ == "__main__":
    main()
