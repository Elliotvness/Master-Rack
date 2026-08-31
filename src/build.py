#!/usr/bin/env python3
"""
Build rack-master-studio-blueprint.html from the section files in src/parts/.

    python build.py            # build, then run the structural checks
    python build.py --no-check # build only

Pure standard library. No dependencies, no network.

The blueprint is assembled by concatenating numbered section files in order.
Nothing is templated or transformed: what is in the parts is what ends up in
the output, byte for byte. That keeps edits reviewable and the build trivially
reproducible.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PARTS_DIR = HERE / "parts"
OUTPUT = HERE.parent / "rack-master-studio-blueprint.html"

# Only files named NN-something.html are sections. This pattern is deliberate:
# a stray file in parts/ (an editor backup, an accidental redirect) must not be
# silently swept into the document. That has happened once already.
SECTION_RE = re.compile(r"^\d{2}-[A-Za-z0-9_-]+\.html$")

EXPECTED_SECTIONS = 14


def collect() -> list[Path]:
    if not PARTS_DIR.is_dir():
        sys.exit(f"ERROR: no parts directory at {PARTS_DIR}")

    everything = sorted(p for p in PARTS_DIR.iterdir() if p.is_file())
    sections = [p for p in everything if SECTION_RE.match(p.name)]
    ignored = [p for p in everything if p not in sections]

    if ignored:
        print("  ignored (not a NN-name.html section):")
        for p in ignored:
            print(f"    - {p.name}")

    if not sections:
        sys.exit("ERROR: no section files matched NN-name.html")

    if len(sections) != EXPECTED_SECTIONS:
        print(
            f"  NOTE: found {len(sections)} sections, expected {EXPECTED_SECTIONS}. "
            "If you added or removed one deliberately, update EXPECTED_SECTIONS."
        )

    return sections


def build() -> str:
    sections = collect()
    print(f"  concatenating {len(sections)} sections:")
    chunks = []
    for p in sections:
        text = p.read_text(encoding="utf-8")
        chunks.append(text)
        print(f"    {p.name:<20} {len(text.encode('utf-8')):>8,} bytes")
    return "".join(chunks)


def main() -> int:
    print(f"Building {OUTPUT.name}")
    html = build()

    # Write the exact bytes. write_text would translate \n to \r\n on Windows,
    # so the output would stop being the byte-for-byte concatenation of the
    # parts that the README promises, and the byte-identical comparison below
    # could never fire.
    payload = html.encode("utf-8")
    previous = OUTPUT.read_bytes() if OUTPUT.exists() else None
    OUTPUT.write_bytes(payload)
    size = len(payload)

    if previous is None:
        print(f"  wrote {OUTPUT}  ({size:,} bytes)")
    elif previous == payload:
        print(f"  wrote {OUTPUT}  ({size:,} bytes) — byte-identical to the previous build")
    else:
        delta = size - len(previous)
        print(f"  wrote {OUTPUT}  ({size:,} bytes, {delta:+,} vs previous)")

    if "--no-check" in sys.argv:
        print("  checks skipped (--no-check)")
        return 0

    print()
    try:
        import verify  # noqa: PLC0415  — same directory
    except ImportError:
        print("  verify.py not found; skipping checks")
        return 0
    return verify.run(OUTPUT)


if __name__ == "__main__":
    raise SystemExit(main())
