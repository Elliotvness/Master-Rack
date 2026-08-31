"""Store the EXACT published beam face heights; display is a separate concern.

Owner decision 2026-08-31 (P0-009). Face height enters an elevation stack once
per level and truncation errs the same direction every time, so a one-decimal
STORED value accumulates up to ~1.25" over a 20-level stack, in the direction
that reports more clear height than exists. The engine therefore keeps the
exact published fraction; one-decimal is a DISPLAY convention.

Values are the fractions printed on PSG 2025 p.84, converted exactly:
  27E  2 3/4    = 2.75      (exact as printed - no decimal was discarded)
  36E  3 21/32  = 3.65625
  40E  4        = 4.0
  45E  4 1/2    = 4.5
  50E  5        = 5.0
  59E  5 15/16  = 5.9375
  65E  6 9/16   = 6.5625
  65Q  6 9/16   = 6.5625

This also closes both outstanding disputes: 5.92/5.928/5.93 and 6.54/6.56 were
all approximations of a fraction the guide states exactly.
"""
import json, pathlib, hashlib

repo = pathlib.Path(r'C:\Rack Master\rack-master-studio')
d = repo / 'data/catalog/interlake-2026-09'

EXACT = {
    '27E': 2 + 3 / 4,
    '36E': 3 + 21 / 32,
    '40E': 4.0,
    '45E': 4.5,
    '50E': 5.0,
    '59E': 5 + 15 / 16,
    '65E': 6 + 9 / 16,
    '65Q': 6 + 9 / 16,
}

def base_family(f):
    return f[:-1] if f.endswith('R') and f != '65Q' else f

doc = json.loads((d / 'beams.json').read_text(encoding='utf-8'))
changed = 0
for r in doc['rows']:
    want = EXACT[base_family(r['family'])]
    if r['face_height_in'] != want:
        r['face_height_in'] = want
        changed += 1

(d / 'beams.json').write_text(
    json.dumps(doc, indent=1, sort_keys=True, ensure_ascii=False) + '\n', encoding='utf-8')

digest = hashlib.sha256(
    json.dumps(doc['rows'], sort_keys=True, separators=(',', ':')).encode()).hexdigest()

m = json.loads((d / 'manifest.json').read_text(encoding='utf-8'))
m['content_sha256'] = digest

m['face_height_policy'] = {
    "stored": "the exact published fraction (e.g. 5 15/16 = 5.9375)",
    "displayed": "one decimal place",
    "page_ref": "p.84 'BEAM PROFILES'",
    "decided_by": "Elliott Villacorta",
    "decided_at": "2026-08-31",
    "reason": (
        "Face height enters an elevation stack once per beam level, and rounding or truncating "
        "errs the same direction every time, so the error accumulates rather than cancelling: a "
        "one-decimal STORED value drifts up to about 1.25\" over a 20-level stack (65E), which "
        "exceeds the ~1/4\" a pallet opening is specified to, and it drifts in the direction that "
        "reports MORE clear height than exists. The engine therefore stores the exact published "
        "fraction and the interface rounds for display only. 27E and 45E are printed as exact "
        "values (2 3/4, 4 1/2), so a one-decimal store would have discarded a digit the "
        "manufacturer actually published."
    ),
}

m['face_height_59e_status'] = {
    "disposition": "RESOLVED",
    "value_in": 5.9375,
    "printed_as": "5 15/16\"",
    "page_ref": "p.84 'BEAM PROFILES'",
    "resolved_by": "Elliott Villacorta",
    "resolved_at": "2026-08-31",
    "reason": (
        "P0-005 closed. Four figures had been in circulation - 5.92 (the 2026-08 transcription), "
        "5.928 (a documentation table), 5.93 (the guide's own two-decimal rendering) and 5.9375 "
        "(the exact fraction). They were all approximations of one published value: p.84 prints "
        "5 15/16\". Storing the exact fraction ends the dispute rather than settling it, because "
        "there is no longer a rounding choice to disagree about. 5.92 appears nowhere in the "
        "source document."
    ),
}

# The 65E/65Q discrepancy is resolved by the same decision, so it stops being an
# open anomaly. Drop the OPEN note and record the resolution.
m['source_anomalies'] = [a for a in m['source_anomalies'] if not a.startswith('OPEN, NOT RULED ON')]
m['face_height_65_status'] = {
    "disposition": "RESOLVED",
    "value_in": 6.5625,
    "printed_as": "6 9/16\"",
    "page_ref": "p.84 'BEAM PROFILES'",
    "resolved_by": "Elliott Villacorta",
    "resolved_at": "2026-08-31",
    "reason": (
        "The 2026-08 extract carried 6.54 for 65E/65ER/65Q/65QR, which matches neither the "
        "printed fraction 6 9/16 (6.5625) nor the guide's own two-decimal rendering (6.56). "
        "Found by the page-84 cross-check that resolved 59E, and closed by the same policy "
        "decision: store the exact fraction."
    ),
}

(d / 'manifest.json').write_text(
    json.dumps(m, indent=1, sort_keys=True, ensure_ascii=False) + '\n', encoding='utf-8')

print(f"rows updated: {changed} of {len(doc['rows'])}")
print(f"face heights now: {sorted({r['face_height_in'] for r in doc['rows']})}")
print(f"new content_sha256: {digest}")
