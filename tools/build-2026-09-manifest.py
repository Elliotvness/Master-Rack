import json, pathlib, hashlib

repo = pathlib.Path(r'C:\Rack Master\rack-master-studio')
old_dir = repo / 'data/catalog/interlake-2026-08'
new_dir = repo / 'data/catalog/interlake-2026-09'

rows = json.loads((new_dir / 'beams.json').read_text(encoding='utf-8'))['rows']
digest = hashlib.sha256(
    json.dumps(rows, sort_keys=True, separators=(',', ':')).encode()).hexdigest()

old = json.loads((old_dir / 'manifest.json').read_text(encoding='utf-8'))

m = {
    "catalog_rev": "Interlake Mecalux Product Support Guide 2025 (SEL-PSG-12/2025), 98-page PDF",
    "rev": "2026-09",
    "manufacturer": "Interlake Mecalux",
    "status": "APPROVED",
    "row_count": len(rows),
    "content_sha256": digest,
    "units": "lbs",

    "source_document": "Selective PSG_2025.pdf (Product Support Guide - Selective Rack - Roll Formed Beams and Frames, 2025, SEL-PSG-12/2025)",
    "source_url": "https://www.interlakemecalux.com/",
    "page_ref": "p.88 'BEAM WITH TAB END PLATE CAPACITY CHART: 27E - 65Q, 48\"-168\"' (Slotted and Unslotted Step Beam Capacities, lbs per pair); p.84 'BEAM PROFILES' (family/gauge table, characters 3-5 of the 18-digit product code); p.83 end-plate models F3M/F4M/F5M",

    "digitised_by": "automated extract (Claude)",
    "digitised_at": "2026-08-31",
    "approved_by": "Elliott Villacorta",
    "approved_at": "2026-08-31",

    # AC-18: a single human signature needs a recorded independent verification
    # path. The digitiser is a machine, so identity alone would not establish a
    # second party. The path recorded here is a full cross-check: all 336 rows
    # were re-derived from the chart transcribed out of PDF page 88 and compared
    # cell by cell, by kernel-catalog/src/psg-authority.test.ts, which runs on
    # every build rather than once at approval time.
    "verification_path": {
        "kind": "full_cross_check",
        "cells": len(rows),
        "note": (
            "All 336 capacity cells re-derived from PDF page 88 and compared against the "
            "shipped rows by packages/kernel-catalog/src/psg-authority.test.ts, which is "
            "wired into the test run. The chart was also parsed directly from the PDF "
            "independently of the supplied spreadsheet, and the two agree on every row. "
            "End-plate assignment cross-checked against page 84 and character 13 of each "
            "18-digit code."
        ),
    },

    "load_basis": old["load_basis"],
    "deflection_limit": "L/180 (p.88: 'lesser of strength in bending, or L/180 deflection criteria')",
    "code_basis": "RMI guidelines and ANSI MH16.1-2012 (p.88 footnote); FY = 55 KSI",
    "constraints": {
        "brace_required_over_in": 126,
        "crossbar_required_over_in_when_decked": 90,
    },

    "authority": (
        "SOLE for beam capacity. Established by owner decision 2026-08-31 (P0-008)."
    ),
    "disregarded": [
        "Mecalux Material Catalog (Mecalux_Material_Catalog.xlsx) - DISREGARDED FOR CAPACITY "
        "VALUES. It describes a different product line (25E, 31E, 35E, 39E, 43E, 47E, 55E, "
        "65Q-DX) and carries no capacity data for twelve of the sixteen families this catalog "
        "covers (27E/27ER, 36E/36ER, 40E/40ER, 45E/45ER, 50ER, 59ER, 65ER, 65QR). Where both "
        "sources do overlap they disagree on every span - e.g. 65E at 48\" reads 17,115 lbs in "
        "PSG 2025 and 15,000 lbs in the Material Catalog. A prior reconciliation recommended "
        "using the Material Catalog for capacity lookups; that recommendation is superseded as "
        "IMPOSSIBLE TO SATISFY, not merely rejected - the data it points to does not exist for "
        "most of our families. Recorded here so a future reader does not 'restore' it under the "
        "impression it was dropped by accident."
    ],

    "changes_from_2026_08": [
        "264 capacity values corrected to the published chart. The 2026-08 extract carried "
        "values that were consistently off by 5-25 lbs, none of which appear anywhere in the "
        "source document.",
        "42 rows REMOVED: 40E and 40ER under an F3M (6\", 3-tab) end plate. Page 84 publishes "
        "F3M for 27E and 36E only, and page 88 groups the 40E column under F4M. Character 13 of "
        "those rows' own codes reads 'C' (F3M) on a 40E beam, which the code format does not "
        "allow. They were a phantom variant: not published, and reading 3.8-12.2% BELOW the "
        "real 40E capacity, so the engine would have quoted a beam that does not exist while "
        "appearing conservative.",
        "No part number, code_18, face height or deflection value was altered. Only capacity "
        "was re-sourced, and only unpublished rows were removed.",
    ],

    "source_anomalies": [
        "code_18 IB65QT16200RRA4000 (65QR, 162\") carries end-plate letter 'R' where the F5M "
        "series specifies 'S'. Its 65Q sibling at the same span reads IB65QT16200RSA2000 and "
        "every other 65QR row reads ...RSA4000. Transcribed verbatim as published; pinned as a "
        "named exemption in psg-authority.test.ts so a NEW wrong letter still fails the build.",
        "Five 65QR code_18 values are 17 characters where the format specifies 18: "
        "IB65QT05400RSA400 (54\"), IB65QT06600RSA400 (66\"), IB65QT07800RSA400 (78\"), "
        "IB65QT12600RSA400 (126\"), IB65QT15000RSA400 (150\"). Published that way; the exact set "
        "is pinned by test so a sixth would fail.",
        "part_number UM005516 appears on 2 rows (65QR 54\" and 60\"); UM005517 appears on 2 rows "
        "(65QR 66\" and 72\"). Carried forward from the 2026-08 extract, unchanged.",
        old["source_anomalies"][-1],
    ],

    "face_height_59e_status": old["face_height_59e_status"],
}

body = json.dumps(m, indent=1, sort_keys=True, ensure_ascii=False) + '\n'
(new_dir / 'manifest.json').write_text(body, encoding='utf-8')
print(f"manifest written. rows={len(rows)} sha={digest}")
print(f"status={m['status']} approved_by={m['approved_by']}")
