# /// script
# requires-python = ">=3.10"
# dependencies = ["playwright", "cryptography"]
# ///
import argparse
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from check_design import launch  # noqa: E402

VIEWPORT = {"width": 1440, "height": 900}
FORMULA_PROBLEMS = """() => [...document.querySelectorAll('.math')].flatMap((element) => {
  const problems = [];
  const svgs = element.querySelectorAll(':scope > svg');
  const svg = svgs[0];
  if (svgs.length !== 1) problems.push(`${svgs.length} svg elements`);
  if (!svg) problems.push('no svg');
  else if (svg.getBoundingClientRect().width === 0) problems.push('empty svg');
  if (element.textContent.includes('\\\\')) problems.push('TeX source visible');
  if (element.querySelector('[data-mml-node="merror"]')) problems.push('MathJax error');
  return problems.map((problem) => `${element.dataset.tex}: ${problem}`);
})"""
MISSING_GLYPHS = """() => [...document.querySelectorAll('.math use')]
  .map((use) => use.getAttribute('href'))
  .filter((href) => !document.getElementById(href.slice(1)))"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("page", type=Path)
    parser.add_argument("screenshot", type=Path)
    parser.add_argument("--browser", choices=["chrome", "chromium"], default="chrome")
    args = parser.parse_args()
    errors = []
    with sync_playwright() as p:
        browser = launch(p, args.browser)
        page = browser.new_page(viewport=VIEWPORT)
        page.on("console", lambda msg: msg.type == "error" and errors.append(f"console: {msg.text}"))
        page.on("pageerror", lambda exc: errors.append(f"pageerror: {exc}"))
        page.on("requestfailed", lambda req: errors.append(f"requestfailed: {req.url}"))
        page.goto(args.page.resolve().as_uri(), wait_until="load")
        page.screenshot(path=args.screenshot, full_page=True)
        count = page.locator(".math").count()
        errors += page.evaluate(FORMULA_PROBLEMS)
        errors += [f"missing glyph {href}" for href in page.evaluate(MISSING_GLYPHS)]
        browser.close()
    print(f"{count} formulas")
    for error in errors:
        print(error)
    sys.exit(1 if errors or count == 0 else 0)


if __name__ == "__main__":
    main()
