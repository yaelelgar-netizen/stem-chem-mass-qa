#!/usr/bin/env python3
"""
asset_localization_report.py — לומדת מסה (STEM Chem 2 — Mass)

Hand-maintained list of image assets with Hebrew text baked into the
graphic itself (not translatable as text). There is no reliable way to
auto-detect this, so re-review new/changed images by eye and update the
ASSETS list below, then re-run this script.

This project follows a "no baked Hebrew text" rule for anything content-
related (all sentence/question/dialogue text is live HTML per project
convention), so this list should stay short: mainly reusable UI-chrome
graphics like the check/submit button.

Usage:
    python3 translation/tools/asset_localization_report.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXPORT_DIR = ROOT / "translation" / "export"
OUT_PATH = EXPORT_DIR / "asset_localization_report.json"

ASSETS = [
    {
        "file": "assets/images/check-button.png",
        "bakedText": "צדקתי?",
        "usedInScreens": [
            "screen-5", "screen-9", "screen-13", "screen-16",
            "screen-19", "screen-22", "screen-25", "screen-27",
        ],
        "note": (
            "Reusable submit-button graphic (the check-btn <img>), used identically "
            "on every question screen. Needs one fresh Arabic export to replace "
            "everywhere it's referenced — not a per-screen translation."
        ),
    },
    {
        "file": "assets/images/end-button.png",
        "bakedText": "סיימתי",
        "usedInScreens": ["screen-28"],
        "note": (
            "Closing submit button. NOTE: the FINAL script (slide 39) labels this "
            "button 'סיום', but the supplied artwork reads 'סיימתי'. Confirm the "
            "intended wording with the writer before the Arabic export is cut."
        ),
    },
    {
        "file": "assets/images/bg-7.jpg",
        "bakedText": "כדור הארץ / ירח / חללית",
        "usedInScreens": ["screen-4"],
        "note": (
            "Background plate for slide 7 was exported with the three panel labels "
            "already burned in, which the art bible forbids. The live labels that "
            "belong at (1032,684) (1269,710) (1575,741) are therefore commented out "
            "in index.html to avoid duplicate text — restore them once a clean plate "
            "is exported from Moon_2.psd."
        ),
    },
]


def main():
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    out = {
        "meta": {
            "unit": "לומדת מסה — STEM כימיה 2, כיתה ז'",
            "method": (
                "Hand-reviewed by eye against index.html + assets/images/ — this "
                "project's convention keeps all question/dialogue/instruction text "
                "as live HTML (never baked into images) specifically so it can be "
                "translated as text, so this list is expected to stay short and "
                "cover only reusable UI-chrome graphics."
            ),
            "regenerate": "python3 translation/tools/asset_localization_report.py (after updating the ASSETS list by hand)",
        },
        "assets": ASSETS,
    }
    OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {OUT_PATH} — {len(ASSETS)} asset(s)")


if __name__ == "__main__":
    main()
