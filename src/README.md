# Blueprint source

The blueprint is assembled from the section files in `parts/`. Edit a section, rebuild, check.

```
python build.py
```

That writes `../rack-master-studio-blueprint.html` and runs the structural checks. On Windows you can double-click `build.cmd` instead.

## Why it is built this way

`rack-master-studio-blueprint.html` is a single 316 KB file with 19 sections and 7 hand-drawn SVG diagrams. Editing it directly works, but every change means scrolling through the whole document to find the right place and every diff is against one enormous file. Splitting it by section keeps edits scoped and reviewable.

The build is a plain concatenation. Nothing is templated, substituted or minified — what is in the parts is what ends up in the output, byte for byte. If the build ever produces something you did not write, that is a bug in the build, not a feature of it.

## Layout

```
src/
├── build.py              concatenate parts/ -> ../rack-master-studio-blueprint.html
├── build.cmd             Windows double-click wrapper
├── verify.py             structural checks; the gate
├── verify-visual.py      optional browser checks; the pre-handoff sweep
├── parts/                14 section files, concatenated in filename order
└── research/             the sourced external research behind the blueprint's claims
```

### `parts/`

| File | Blueprint section |
|---|---|
| `01-head.html` | `<head>`, all CSS, the sidebar nav, the opening `<main>` |
| `02-s1.html` | masthead + §1 overview and business problem |
| `03-s2.html` | §2 roles and permission matrix |
| `04-s3.html` | §3 workflows and lifecycle · **Figures 1–2** |
| `05-s4.html` | §4 functional + §5 non-functional requirements |
| `06-s6.html` | §6 architecture · **Figure 3** |
| `07-s7.html` | §7 canonical data model · **Figures 4–5** |
| `08-s8.html` | §8 API boundaries + §9 client-visible vs internal · **Figure 6** |
| `09-s10.html` | §10 catalog, rules and provenance |
| `10-s11.html` | §11 validation + §12 BOM/takeoff |
| `11-s13.html` | §13 submission and audit + §14 security and tenancy |
| `12-s15.html` | §15 roadmap and MVP + §16 tests and acceptance |
| `13-s17.html` | §17 reference projects and reuse · **Figure 7** |
| `14-s18.html` | §18 decisions + §19 risks, footer, closing tags, JavaScript |

Filename order is the document order. `build.py` only picks up files matching `NN-name.html`, so an editor backup or a stray redirect in `parts/` cannot be swept into the document — that has happened once.

If you add a section, name it to sort into place and bump `EXPECTED_SECTIONS` in `build.py`.

### `research/`

The two external research briefs the blueprint's non-obvious claims rest on, each ending in a source list of real URLs.

- `research-security-multitenant.md` — tenant isolation, Postgres RLS correctness, invitation token design, the authentication ladder, authorization models, audit logging and tamper evidence, field-leakage prevention. Includes a standards-status check as of August 2026 and an explicit list of what could not be verified from a primary source.
- `research-cpq-bom-provenance.md` — configurator architecture, how PLM and CPQ systems pin a configuration to a rule version, BOM effectivity, engineering change control, immutable records and deterministic re-computation, RFQ intake, W3C PROV, and document release control including the ISO 19650 P/C convention.

The blueprint states conclusions; these carry the sourcing. When a claim in the document is challenged, the URL is here. Paywalled standards are marked as verified only to their published scope, never quoted from text nobody read — which is the same standard the product itself is held to.

## Checks

`verify.py` runs on every build. Standard library only, except one optional dependency:

```
pip install html5lib      # adds strict HTML validation; everything else runs without it
```

| Check | Guards against |
|---|---|
| strict HTML parse | malformed markup that renders anyway in one browser |
| self-contained | a CDN link or font import creeping in; the file must work offline |
| anchors resolve | a renamed section leaving dead `§` cross-references |
| 19 sections / 7 figures in order | a section lost or duplicated by a bad edit |
| diagrams labelled | an SVG without a text alternative |
| svg markers resolve | an arrowhead referencing a `<defs>` id that no longer exists |
| **no client identifiers** | client names, quote numbers or pricing reaching a document the README says carries none |
| **language discipline** | "tamper-proof", "stamped engineering review", "prelim turnaround" — each is a claim the product must not make |
| svg geometry in bounds | a diagram element drawn outside its own viewBox and clipped |
| in-document links intercepted | the anchor click handler being removed — see below |

`verify-visual.py` is optional and needs Playwright. It catches what markup inspection cannot: horizontal overflow at desktop, mobile and in dark theme; JavaScript errors on load; and that in-document links still scroll rather than navigate when the file is embedded in a preview pane.

```
pip install playwright && playwright install chromium
python verify-visual.py
```

## Two things that look odd and are not

**In-document links are handled in JavaScript, not left to the browser.** A preview pane embeds the file with `srcdoc`, and a `srcdoc` document inherits the *host page's* base URL. A plain `href="#s5"` therefore resolves against the host, and clicking it navigates the pane away rather than scrolling — on a chat surface, straight to a new conversation. The click handler at the bottom of `14-s18.html` intercepts every in-document link and scrolls to the target instead. Removing it breaks the document everywhere except a plain local file. `verify.py` checks it is still there and `verify-visual.py` proves it works.

**Diagrams are hand-written inline SVG, not Mermaid or a diagram library.** They scale, they print, they carry `role="img"` and an `aria-label`, they theme with `currentColor`, and there is no fallback to arrange because there is nothing that can fail to load. They are also, deliberately, more work to edit — the `.s-box`, `.s-ln`, `.s-t` classes in `01-head.html` are the shared vocabulary, and coordinates are on a grid so shared baselines and even gaps come out right. If a diagram wants more than that, it wants a real drawing tool and an exported asset, not more path data.

## Before handing the document to anyone

```
python build.py           # builds and runs the structural checks
python verify-visual.py   # optional, if Playwright is installed
```

Then confirm by eye: the sidebar highlights as you scroll, the theme button works in both directions, and `Ctrl/Cmd-P` produces a clean document with the sidebar gone and the expandable panels opened.
