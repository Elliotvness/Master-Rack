"""
Extract the Interlake beam capacity data from the read-only reference project
into declarative JSON, WITHOUT executing the source module.

Rules honoured here:
  - The reference tree is READ-ONLY. This reads one file and never writes to it.
  - The catalog must be DATA, not executable Python (blueprint rejects runpy).
    So the source is parsed with Python's `ast` and the literals are pulled out
    with `ast.literal_eval` — the module is never imported or run.
  - Every provenance field is carried VERBATIM. Nothing is corrected, filled or
    invented. The published anomalies travel as published.
  - Status is carried forward as declared (PENDING_CHECK). Approval in the new
    system is a human act recorded as OD-07; this script does not grant it.

Run from the new project root. Emits data/catalog/interlake-2026-08/.
"""

import ast
import hashlib
import json
import os

SOURCE = (
    r"C:\Rack Master\Resourse (do not delete or overwrite files)"
    r"\rack-engine\catalog\interlake-2026-08\cap_beams_published.py"
)
OUT_DIR = os.path.join("data", "catalog", "interlake-2026-08")


def module_literals(path):
    """Parse the module and return a dict of its top-level literal assignments.

    Uses ast.literal_eval, so only literals are evaluated — no code runs.
    """
    with open(path, "r", encoding="utf-8") as fh:
        tree = ast.parse(fh.read(), filename=path)

    out = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1:
            target = node.targets[0]
            if isinstance(target, ast.Name):
                try:
                    out[target.id] = ast.literal_eval(node.value)
                except ValueError:
                    # Not a pure literal (e.g. a concatenated string expr).
                    # Fall back to compiling just that expression.
                    out[target.id] = ast.literal_eval(
                        compile(ast.Expression(node.value), path, "eval")
                    )
    return out


def main():
    lits = module_literals(SOURCE)

    components = lits["COMPONENTS"]
    assert isinstance(components, list) and components, "no COMPONENTS found"

    # Manifest carries every provenance field verbatim from the source module.
    manifest = {
        "manufacturer": "Interlake Mecalux",
        "rev": "2026-08",
        "status": "DRAFT",  # re-enters DRAFT in the new system; see note below.
        "source_status_carried": lits.get("STATUS"),
        "sheet_name": lits.get("SHEET_NAME"),
        "catalog_rev": lits.get("CATALOG_REV"),
        "source_pdf": lits.get("SOURCE_PDF"),
        "source_url": lits.get("SOURCE_URL"),
        "page_ref": lits.get("PAGE_REF"),
        "digitised_by": lits.get("DIGITISED_BY"),
        "digitised_at": lits.get("DIGITISED_AT"),
        "checked_by": lits.get("CHECKED_BY"),
        "checked_at": lits.get("CHECKED_AT"),
        "units": lits.get("UNITS"),
        "load_basis": lits.get("LOAD_BASIS"),
        "deflection_limit": lits.get("DEFLECTION_LIMIT"),
        "code_basis": lits.get("CODE_BASIS"),
        "constraints": lits.get("CONSTRAINTS"),
        "source_anomalies": lits.get("SOURCE_ANOMALIES"),
        "headers": lits.get("HEADERS"),
        "row_count": len(components),
    }

    os.makedirs(OUT_DIR, exist_ok=True)

    # Beams file: the rows, canonical and sorted for a stable content hash.
    beams = {
        "schema_version": 1,
        "manufacturer": manifest["manufacturer"],
        "rev": manifest["rev"],
        "rows": components,
    }
    beams_text = json.dumps(beams, indent=2, sort_keys=True, ensure_ascii=False)
    beams_path = os.path.join(OUT_DIR, "beams.json")
    with open(beams_path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(beams_text + "\n")

    # Content hash over the canonical rows text, recorded in the manifest.
    manifest["content_sha256"] = hashlib.sha256(beams_text.encode("utf-8")).hexdigest()

    manifest_path = os.path.join(OUT_DIR, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(manifest, indent=2, sort_keys=True, ensure_ascii=False) + "\n")

    # Report.
    families = sorted({r["family"] for r in components})
    spans = sorted({r["span_in"] for r in components})
    print(f"rows            : {len(components)}")
    print(f"families        : {len(families)}  {families}")
    print(f"unique spans    : {len(spans)}  {spans}")
    print(f"source status   : {manifest['source_status_carried']}")
    print(f"anomalies       : {len(manifest['source_anomalies'])}")
    print(f"content_sha256  : {manifest['content_sha256']}")
    print(f"wrote           : {beams_path}")
    print(f"wrote           : {manifest_path}")


if __name__ == "__main__":
    main()
