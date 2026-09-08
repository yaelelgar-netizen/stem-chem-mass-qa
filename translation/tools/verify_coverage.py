#!/usr/bin/env python3
"""
verify_coverage.py — independent sanity sweep for extract_translations.py
(לומדת נפח — STEM Chem 1: Volume)

Walks every individual text node (NOT comments, NOT script/style) inside
each .screen section and inside each of the three embedded applets
(applets/calibration.html, applets/displacement.html,
applets/floating-body.html), and checks that its Hebrew-bearing content is
captured as a substring of *some* manifest entry. Also independently
re-derives the data-fb-correct/data-fb-incorrect attribute values and the
vcap-src video captions, since those are the two extraction paths most
likely to silently miss something if a screen's markup deviates from the
usual pattern.

Anything printed below is a candidate miss — a human should decide whether
it was rightly excluded (e.g. a dev-only comment, or non-Hebrew UI chrome)
or is a real gap that extract_translations.py needs to handle.

Unlike the JSX-based Murals project, all three applets here are plain HTML
(no React/JSX), so they can be parsed as real DOM with BeautifulSoup rather
than a best-effort regex — this sweep is a stricter, more literal re-check
than the murals equivalent, not a heuristic one.
"""
import json
import re
from pathlib import Path
from bs4 import BeautifulSoup, Comment

ROOT = Path(__file__).resolve().parents[2]
HEBREW_RE = re.compile(r"[֐-׿]")
WS_RE = re.compile(r"\s+")


def norm(t):
    return WS_RE.sub(" ", t).strip()


def has_hebrew(t):
    return bool(HEBREW_RE.search(t))


manifest = json.loads((ROOT / "translation/export/chem2mass_translation_manifest.json").read_text(encoding="utf-8"))
all_entries = manifest["entries"] + manifest.get("orphaned", [])
all_source_text = norm(" \x00 ".join(e["source"] for e in all_entries))


def sweep_text_nodes(soup, scope_iter, misses, loc_fn):
    for scope in scope_iter:
        for node in scope.find_all(string=True):
            if isinstance(node, Comment):
                continue
            if node.parent and node.parent.name in ("script", "style", "template"):
                continue
            text = norm(str(node))
            if not text or not has_hebrew(text):
                continue
            if text not in all_source_text:
                misses.append((loc_fn(scope, node), text))


def sweep_attrs(soup, misses, label_prefix=""):
    for el in soup.find_all(True):
        if el.name in ("script", "style"):
            continue
        for attr in ("alt", "aria-label", "title", "placeholder"):
            val = el.get(attr)
            if not val or not has_hebrew(val):
                continue
            val = norm(val)
            if val not in all_source_text:
                misses.append((f"{label_prefix}[attr:{attr}] {el.name}", val))


# ── index.html ──
html = (ROOT / "index.html").read_text(encoding="utf-8")
soup = BeautifulSoup(html, "html.parser")

misses = []
sections = soup.find_all("section", class_="screen")
sweep_text_nodes(soup, sections, misses, lambda s, n: f"screen-{s.get('data-screen')}")
sweep_attrs(soup, misses)

# independently re-derive feedback attributes and video captions, since
# those two are read from attributes/synced-span structure rather than
# plain visible text and could silently diverge from the extractor's logic
for section in sections:
    n = section.get("data-screen")
    smeta = section.find("div", class_="smeta")
    if smeta:
        for attr in ("data-fb-correct", "data-fb-incorrect"):
            val = smeta.get(attr)
            if val and has_hebrew(val) and norm(val) not in all_source_text:
                misses.append((f"screen-{n} [attr:{attr}]", norm(val)))
    for src in section.find_all("div", class_="vcap-src"):
        for span in src.find_all("span", attrs={"data-t": True}):
            text = norm(span.get_text(" ", strip=True))
            if text and has_hebrew(text) and text not in all_source_text:
                misses.append((f"screen-{n} [vcap-src span]", text))

print(f"index.html: {len(misses)} unmatched Hebrew fragments")
for loc, text in misses:
    print(f"  {loc!r:30} {text[:80]!r}")

# ── the three embedded applets (plain HTML — real DOM, not JSX) ──
APPLETS = ["calibration.html", "displacement.html", "floating-body.html"]
applet_misses = []
for name in APPLETS:
    p = ROOT / "applets" / name
    if not p.exists():
        continue
    a_html = p.read_text(encoding="utf-8")
    a_soup = BeautifulSoup(a_html, "html.parser")
    body = a_soup.find("body") or a_soup
    sweep_text_nodes(a_soup, [body], applet_misses, lambda s, n, nm=name: nm)
    sweep_attrs(a_soup, applet_misses, label_prefix=f"{name} ")
    title_tag = a_soup.find("title")
    if title_tag and has_hebrew(title_tag.get_text()):
        t = norm(title_tag.get_text())
        if t not in all_source_text:
            applet_misses.append((f"{name} <title>", t))
    # Hebrew string literals inside <script> (same pattern the extractor
    # scans) — independently re-derived here for the sanity check
    for script in a_soup.find_all("script"):
        code = script.string or ""
        if not code:
            continue
        for m in re.finditer(r"(['\"`])((?:(?!\1).)*[֐-׿](?:(?!\1).)*)\1", code):
            raw = m.group(2)
            if "<" in raw and ">" in raw:
                frag = BeautifulSoup(raw, "html.parser")
                for sub_text in frag.find_all(string=True):
                    t = norm(str(sub_text))
                    if t and has_hebrew(t) and t not in all_source_text:
                        applet_misses.append((f"{name} <script> HTML-template literal", t))
            else:
                t = norm(raw)
                if t and has_hebrew(t) and t not in all_source_text:
                    applet_misses.append((f"{name} <script> literal", t))

print(f"\napplets/*.html: {len(applet_misses)} unmatched Hebrew fragments")
for loc, text in applet_misses:
    print(f"  {loc!r:40} {text[:80]!r}")

total_misses = len(misses) + len(applet_misses)
print(f"\nTOTAL: {total_misses} unmatched fragment(s)" + (" — coverage looks complete." if total_misses == 0 else " — review above."))
