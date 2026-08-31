#!/usr/bin/env python3
"""
Structural checks on the built blueprint.

    python verify.py                     # check the sibling blueprint
    python verify.py path/to/file.html   # check a specific file

Standard library only for the core checks. If html5lib is installed it also
runs a strict parse; if not, that one check is skipped and everything else
still runs.

    pip install html5lib      # optional, adds strict HTML validation

These are the checks that actually caught defects while the document was being
written. Each one guards something a well-meaning edit can quietly break.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT = HERE.parent / "rack-master-studio-blueprint.html"

# Client identifiers must not appear in the blueprint. The README states the
# file carries none, and findings from real jobs appear anonymised. The
# identifying detail belongs in open-decisions.md, which is internal-only.
CLIENT_PATTERNS = [
    r"Jam-?N", r"KOAM", r"GoPlus", r"IBOCO", r"Kingmore",
    r"Q-3\d{4}", r"Heraldez",
]

# Language the product must never use about itself.
FORBIDDEN_PHRASES = [
    ("tamper-proof", "say tamper-evident; tamper-proof is a claim the design cannot support"),
    ("stamped engineering review", "outside the scope fence; the clock is called quote delivery"),
    ("prelim turnaround", "the client makes the preliminary; the clock is called acknowledgement"),
]


class Report:
    def __init__(self) -> None:
        self.failures: list[str] = []
        self.notes: list[str] = []

    def ok(self, label: str, detail: str = "") -> None:
        print(f"  PASS  {label}" + (f"  ({detail})" if detail else ""))

    def fail(self, label: str, detail: str) -> None:
        print(f"  FAIL  {label}\n          {detail}")
        self.failures.append(label)

    def skip(self, label: str, why: str) -> None:
        print(f"  SKIP  {label}  ({why})")
        self.notes.append(label)


def run(path: Path | str = DEFAULT) -> int:
    path = Path(path)
    if not path.exists():
        print(f"ERROR: {path} does not exist. Run build.py first.")
        return 1

    s = path.read_text(encoding="utf-8")
    r = Report()
    print(f"Checking {path.name}  ({len(s.encode('utf-8')):,} bytes)")

    # --- strict parse (optional dependency) ---
    try:
        import html5lib
    except ImportError:
        r.skip("strict HTML parse", "html5lib not installed — pip install html5lib")
    else:
        try:
            html5lib.HTMLParser(strict=True).parse(s)
            r.ok("strict HTML parse")
        except Exception as exc:  # noqa: BLE001 — surface whatever the parser says
            r.fail("strict HTML parse", str(exc).strip().splitlines()[0])

    # --- self-contained: nothing may be fetched at view time ---
    external = re.findall(r'(?:src|href)="(?:https?:)?//[^"]*"', s)
    if external:
        r.fail("self-contained", f"{len(external)} external reference(s): {external[:3]}")
    else:
        r.ok("self-contained", "no external src/href")

    for tag, why in (("<script src", "external script"), ("@import", "CSS import")):
        if tag in s:
            r.fail("self-contained", f"{why} found ({tag})")

    # --- every in-document link resolves ---
    ids = set(re.findall(r'id="([^"]+)"', s))
    hrefs = {h for h in re.findall(r'href="#([^"]+)"', s) if h}
    dangling = sorted(hrefs - ids)
    if dangling:
        r.fail("anchors resolve", f"dangling: {dangling}")
    else:
        r.ok("anchors resolve", f"{len(hrefs)} links, {len(ids)} ids")

    # --- structure ---
    sections = re.findall(r'<section id="s(\d+)"', s)
    if [int(x) for x in sections] != list(range(1, 20)):
        r.fail("19 sections in order", f"found {sections}")
    else:
        r.ok("19 sections in order")

    figures = re.findall(r'<figure id="fig(\d)"', s)
    if [int(x) for x in figures] != list(range(1, 8)):
        r.fail("7 figures in order", f"found {figures}")
    else:
        r.ok("7 figures in order")

    # --- every diagram carries a text alternative ---
    svgs = re.findall(r"<svg\b[^>]*>", s)
    unlabelled = [t for t in svgs if 'aria-label' not in t and 'role="img"' not in t]
    if unlabelled:
        r.fail("diagrams labelled", f"{len(unlabelled)} svg(s) without role/aria-label")
    else:
        r.ok("diagrams labelled", f"{len(svgs)} svg elements")

    # --- SVG marker references resolve ---
    markers = set(re.findall(r'<marker id="([^"]+)"', s))
    used = set(re.findall(r'marker-end="url\(#([^)]+)\)"', s))
    if used - markers:
        r.fail("svg markers resolve", f"undefined: {sorted(used - markers)}")
    else:
        r.ok("svg markers resolve")

    # --- no client-identifying data ---
    hits: list[str] = []
    for pat in CLIENT_PATTERNS:
        found = re.findall(pat, s, flags=re.IGNORECASE)
        if found:
            hits.append(f"{pat} x{len(found)}")
    if hits:
        r.fail("no client identifiers", "; ".join(hits) + " — move detail to open-decisions.md")
    else:
        r.ok("no client identifiers")

    # --- language discipline ---
    for phrase, why in FORBIDDEN_PHRASES:
        occurrences = len(re.findall(re.escape(phrase), s, flags=re.IGNORECASE))
        if phrase == "tamper-proof":
            # It appears twice, in the two places that forbid it. More than that
            # means someone used it as a claim.
            if occurrences > 2:
                r.fail("language discipline", f'"{phrase}" appears {occurrences}x — {why}')
            else:
                r.ok("language discipline", f'"{phrase}" only where it is forbidden')
        elif occurrences:
            r.fail("language discipline", f'"{phrase}" appears {occurrences}x — {why}')

    # --- SVG geometry inside its viewBox ---
    out_of_bounds = 0
    for m in re.finditer(r'<svg viewBox="0 0 (\d+) (\d+)"(.*?)</svg>', s, re.S):
        W, H, body = int(m.group(1)), int(m.group(2)), m.group(3)
        for rect in re.finditer(r'<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)"', body):
            x, y, w, h = (float(v) for v in rect.groups())
            if x + w > W + 2 or y + h > H + 2:
                out_of_bounds += 1
        for poly in re.finditer(r'points="([^"]+)"', body):
            nums = poly.group(1).replace(",", " ").split()
            for i in range(0, len(nums) - 1, 2):
                X, Y = float(nums[i]), float(nums[i + 1])
                if not (-5 <= X <= W + 5 and -5 <= Y <= H + 5):
                    out_of_bounds += 1
    if out_of_bounds:
        r.fail("svg geometry in bounds", f"{out_of_bounds} element(s) outside their viewBox")
    else:
        r.ok("svg geometry in bounds")

    # --- in-document navigation is intercepted ---
    # A srcdoc preview inherits the host page's base URL, so a plain #anchor
    # navigates the pane away instead of scrolling. The click handler prevents it.
    if "scrollIntoView" in s and "preventDefault" in s:
        r.ok("in-document links intercepted")
    else:
        r.fail(
            "in-document links intercepted",
            "the anchor click handler is missing; links will navigate a preview pane away",
        )

    print()
    if r.failures:
        print(f"FAILED — {len(r.failures)} check(s): {', '.join(r.failures)}")
        return 1
    print("All checks passed." + (f"  ({len(r.notes)} skipped)" if r.notes else ""))
    return 0


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 and not sys.argv[1].startswith("-") else DEFAULT
    raise SystemExit(run(target))
