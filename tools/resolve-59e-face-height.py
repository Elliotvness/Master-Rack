"""Resolve the 59E face height to the published 5 15/16" (5.93), PSG 2025 p.84.

Only 59E/59ER change. 65E/65ER/65Q/65QR also disagree with page 84 (6.54 vs a
published 6 9/16" = 6.56) but that is a SEPARATE discrepancy the owner has not
ruled on, and rolling it in silently would launder a second decision inside the
first. It is recorded as an open anomaly instead.
"""
import json, pathlib, hashlib

repo = pathlib.Path(r'C:\Rack Master\rack-master-studio')
d = repo / 'data/catalog/interlake-2026-09'

doc = json.loads((d / 'beams.json').read_text(encoding='utf-8'))
changed = 0
for r in doc['rows']:
    if r['family'].startswith('59E'):
        if r['face_height_in'] != 5.93:
            r['face_height_in'] = 5.93
            changed += 1

(d / 'beams.json').write_text(
    json.dumps(doc, indent=1, sort_keys=True, ensure_ascii=False) + '\n', encoding='utf-8')

digest = hashlib.sha256(
    json.dumps(doc['rows'], sort_keys=True, separators=(',', ':')).encode()).hexdigest()

m = json.loads((d / 'manifest.json').read_text(encoding='utf-8'))
m['content_sha256'] = digest

# P0-005 is now closed: the reading has a page reference.
m['face_height_59e_status'] = {
    "disposition": "RESOLVED",
    "value_in": 5.93,
    "printed_as": "5 15/16\"",
    "page_ref": "p.84 'BEAM PROFILES'",
    "resolved_by": "Elliott Villacorta",
    "resolved_at": "2026-08-31",
    "reason": (
        "P0-005 is closed. Three readings existed (5.92 on all 42 transcribed rows, 5.928 in a "
        "documentation table, 5.93 read from the chart) and none carried a page reference, so "
        "none could be promoted to fact. PSG 2025 p.84 prints the 59E profile as 5 15/16\", "
        "which is 5.9375 exactly and is printed by the manufacturer as (5.93\"). That supersedes "
        "the 5.92 transcription, which appears nowhere in the source document. 5.928 is also "
        "superseded: it rounds to 5.93 and was always the weaker of the two corroborating "
        "readings. The published two-decimal figure 5.93 is adopted rather than the exact "
        "5.9375, because the catalog records what the source prints."
    ),
}

anomalies = [a for a in m['source_anomalies'] if 'face_height_in 5.92' not in a]
anomalies.append(
    "OPEN, NOT RULED ON: 65E/65ER/65Q/65QR carry face_height_in 6.54, but PSG 2025 p.84 prints "
    "the 65E and 65Q profiles as 6 9/16\" (6.5625, printed as 6.56\"). Same shape as the 59E "
    "discrepancy that P0-005 resolved, and found by the same page-84 cross-check. NOT changed "
    "here: 59E was resolved by an explicit owner decision, and silently applying that decision to "
    "a different family would be inventing a ruling nobody made. Face height is not a lookup key "
    "and no capacity, span or clearance result depends on it, so this is non-blocking on the same "
    "grounds P0-005 was. It becomes blocking the moment face height is used dimensionally - bay "
    "pitch measured from a beam face, or an elevation drawn to scale."
)
m['source_anomalies'] = anomalies

(d / 'manifest.json').write_text(
    json.dumps(m, indent=1, sort_keys=True, ensure_ascii=False) + '\n', encoding='utf-8')

print(f"59E/59ER rows updated: {changed}")
print(f"new content_sha256: {digest}")
print(f"face heights now: {sorted({r['face_height_in'] for r in doc['rows']})}")
