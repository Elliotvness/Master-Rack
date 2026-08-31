#!/usr/bin/env python3
"""
Optional browser checks for the built blueprint.

    pip install playwright && playwright install chromium
    python verify-visual.py

What verify.py cannot see, because it only reads the markup:

  * horizontal overflow at desktop, mobile and in dark theme
  * JavaScript errors on load
  * that in-document links scroll rather than navigate away, including inside
    an iframe whose base URL belongs to a host page (the preview-pane case)
  * printed page count

Everything here is a nice-to-have. verify.py is the gate; this is the sweep you
run before handing the document to someone.
"""
from __future__ import annotations

import asyncio
import http.server
import socketserver
import sys
import threading
from pathlib import Path

HERE = Path(__file__).resolve().parent
BLUEPRINT = HERE.parent / "rack-master-studio-blueprint.html"

try:
    from playwright.async_api import async_playwright
except ImportError:
    sys.exit(
        "playwright is not installed.\n"
        "  pip install playwright\n"
        "  playwright install chromium"
    )


async def main() -> int:
    if not BLUEPRINT.exists():
        print(f"ERROR: {BLUEPRINT} not found. Run build.py first.")
        return 1

    html = BLUEPRINT.read_text(encoding="utf-8")
    failures: list[str] = []

    # A local host page, so the srcdoc test has a base URL to inherit.
    srv_dir = HERE / ".verify-tmp"
    srv_dir.mkdir(exist_ok=True)
    (srv_dir / "host.html").write_text(
        '<h1 id="who">host</h1><iframe id="f" style="width:1400px;height:800px"></iframe>',
        encoding="utf-8",
    )
    handler = lambda *a, **k: http.server.SimpleHTTPRequestHandler(*a, directory=str(srv_dir), **k)  # noqa: E731
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    async with async_playwright() as pw:
        browser = await pw.chromium.launch()

        # --- overflow and console errors ---
        for theme, width, label in (("light", 1440, "desktop light"),
                                    ("dark", 1440, "desktop dark"),
                                    ("light", 390, "mobile")):
            errors: list[str] = []
            page = await browser.new_page(viewport={"width": width, "height": 1000})
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))
            await page.goto(BLUEPRINT.as_uri())
            await page.evaluate("t => document.documentElement.setAttribute('data-theme', t)", theme)
            await page.wait_for_timeout(400)
            overflow = await page.evaluate(
                "() => document.documentElement.scrollWidth - document.documentElement.clientWidth"
            )
            if overflow > 0:
                print(f"  FAIL  {label}: {overflow}px horizontal overflow")
                failures.append(f"{label} overflow")
            else:
                print(f"  PASS  {label}: no horizontal overflow")
            if errors:
                print(f"  FAIL  {label}: console errors {errors[:2]}")
                failures.append(f"{label} console")
            await page.close()

        # --- in-document links must scroll, not navigate (srcdoc / preview case) ---
        page = await browser.new_page(viewport={"width": 1440, "height": 900})
        await page.goto(f"http://127.0.0.1:{port}/host.html")
        await page.evaluate("bp => document.getElementById('f').srcdoc = bp", html)
        await page.wait_for_timeout(1200)
        before = await page.evaluate("() => document.getElementById('f').contentWindow.scrollY")
        await page.frame_locator("#f").locator('.nav a[href="#s5"]').click()
        await page.wait_for_timeout(900)
        after = await page.evaluate(
            "() => { try { return document.getElementById('f').contentWindow.scrollY } catch (e) { return -1 } }"
        )
        where = await page.evaluate(
            "() => { try { return document.getElementById('f').contentWindow.location.href } catch (e) { return 'ERR' } }"
        )
        if after > before and where.startswith("about:srcdoc"):
            print(f"  PASS  embedded preview: scrolled {before} -> {after}, stayed put")
        else:
            print(f"  FAIL  embedded preview: scrollY {before} -> {after}, location {where[:60]}")
            failures.append("embedded navigation")
        await page.close()

        # --- print ---
        page = await browser.new_page()
        await page.goto(BLUEPRINT.as_uri())
        pdf_path = HERE / ".verify-tmp" / "print-check.pdf"
        await page.pdf(path=str(pdf_path), format="Letter", print_background=True)
        print(f"  INFO  print proof written to {pdf_path.relative_to(HERE)}")
        await page.close()

        await browser.close()

    httpd.shutdown()

    print()
    if failures:
        print(f"FAILED — {', '.join(failures)}")
        return 1
    print("All browser checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
