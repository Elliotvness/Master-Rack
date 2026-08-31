#!/usr/bin/env python3
"""
Extract the three published frame-capacity tables into declarative data.

Same discipline as `extract-catalog.py`, for the same reasons:

  * The source tree is READ-ONLY. This copies out; it never writes in.
  * The source is PARSED, never executed. These files are JSON, so `json.load`
    is already safe, but the rule is stated because the beam extract had to
    reject `runpy.run_path` catalog loading as an arbitrary-code-execution
    vector, and a future source may not be JSON.
  * Values are transcribed VERBATIM. Nothing is rounded, corrected or
    interpolated. Manufacturer errors, if any, are carried as published.

Two things about frame capacity that differ from beams, both load-bearing:

  1. Frame capacity is a function of TWO independent variables, not one:
     (HbL, frame-height band). Models 2.314 / 2.313 / 2.312 have two strut
     patterns -- one for frames under 21 ft and one for frames over -- and
     therefore two capacity columns. A lookup keyed on HbL alone cannot
     reproduce the published table.

  2. The seven QUARANTINED tables in the reference project are REFUSED BY NAME
     below. One overstates capacity by up to 72.4% at HbL 120" because it was
     indexed on overall frame height under an HbL label. Refusing them by name
     is deliberate: relying on a future maintainer to remember which files are
     poisoned is not a control.
"""

import json
import pathlib
import sys

SOURCE_DIR = pathlib.Path(
    r"C:\Rack Master\Resourse (do not delete or overwrite files)"
    r"\rack-app\frame_capacity_published_2025\data"
)
DEST = pathlib.Path("data/catalog/interlake-2026-08/frames.json")

# The three tables that were verified by double extraction, 435/435 cells.
ACCEPTED = [
    "cap_bolted_frames_published.json",
    "cap_bolted_reinforced_frames_published.json",
    "cap_welded_frames_published.json",
]

# Refused by name. Any file whose stem contains one of these is a proven-wrong
# or unverifiable table and must never be extracted.
QUARANTINED_MARKERS = [
    "cap_legacy_frames",   # UL_U77 / UL_U80 appear in no published source
    "quarantine",
    "_TEMPLATE",
    "spot_check",
]


def refuse_quarantined(name: str) -> None:
    lowered = name.lower()
    for marker in QUARANTINED_MARKERS:
        if marker.lower() in lowered:
            sys.exit(
                f"REFUSED: '{name}' matches quarantine marker '{marker}'.\n"
                "The quarantined frame tables are proven wrong or unverifiable. One "
                "overstates published capacity by up to 72.4% at HbL 120 in because it "
                "was indexed on overall frame height under an HbL label. They are not "
                "extracted, and this refusal is by name rather than by memory."
            )


def main() -> None:
    if not SOURCE_DIR.is_dir():
        sys.exit(f"source directory not found (read-only tree): {SOURCE_DIR}")

    tables = []
    total_cells = 0

    for filename in ACCEPTED:
        refuse_quarantined(filename)
        path = SOURCE_DIR / filename
        if not path.is_file():
            sys.exit(f"expected source file missing: {path}")

        doc = json.loads(path.read_text(encoding="utf-8"))

        rows = doc["rows"]
        columns = doc["column_order"]
        # Every row must be complete: a short row would silently shift every
        # capacity one column to the left, which is the worst possible defect
        # in this data and would still look plausible.
        for hbl, values in rows.items():
            if len(values) != len(columns):
                sys.exit(
                    f"{filename}: HbL row {hbl} has {len(values)} values but "
                    f"{len(columns)} columns. Refusing a partial row."
                )
            total_cells += len(values)

        tables.append(
            {
                "table_id": doc["table_id"],
                "units": doc["units"],
                "page_ref": doc["source"]["page_ref"],
                "load_basis": doc["load_basis"],
                "independent_variables": doc["independent_variables"],
                "variants": doc["variants"],
                "column_order": columns,
                # Keys stay strings, sorted numerically, so the output is stable.
                "rows": {k: rows[k] for k in sorted(rows, key=int)},
            }
        )

    out = {
        "schema_version": 1,
        "manufacturer": "Interlake Mecalux",
        "rev": "2026-08",
        "status": "DRAFT",
        "source_document": (
            "Interlake Mecalux Product Support Guide - Selective Roll Formed "
            "Beams and Frames, 2025"
        ),
        "digitised_by": "automated extract (double extraction: page image + embedded text layer)",
        "digitised_at": "2026-08-21",
        "approved_by": "",
        "approved_at": "",
        "verification_path": {
            "kind": "two_path_reconciliation",
            "cells": total_cells,
            "note": (
                "Every capacity cell read twice by independent paths - a visual read of "
                "the rendered page images and a parse of the PDF's embedded text layer - "
                "and reconciled exactly. Evidence, not a signature: a named person must "
                "still approve."
            ),
        },
        "quarantined_not_extracted": [
            "cap_legacy_frames: variants UL_U77 / UL_U80 appear in no published source in this "
            "catalog. Requires the legacy catalog it came from, or deletion. Not inferred.",
            "The synthesised bolted/welded tables previously in rack-app: indexed on overall "
            "frame height under an HbL label, overstating capacity by up to 72.4% at HbL 120 in. "
            "One-directional and unsafe.",
        ],
        "tables": tables,
    }

    DEST.parent.mkdir(parents=True, exist_ok=True)
    DEST.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"extract-frames: {len(tables)} tables, {total_cells} cells, verbatim.")
    print(f"extract-frames: wrote {DEST}")


if __name__ == "__main__":
    main()
