# Testing

## Commands

| Command | What it runs |
|---|---|
| `make check` | Comment check, shellcheck on shell scripts (when installed), unit tests |
| `npm test` | Unit tests only (`node --test` on the files in `test/` that end in `.test.js`) |
| `make example` | Installs the dependencies when needed, builds `examples/blog/` and serves `examples/blog/dist/` at http://127.0.0.1:8000/ |
| `make screenshots [BASE=ref]` | Screenshots of every page of `examples/blog/` built from the working tree, compared with the same pages built from `BASE` (default `origin/main`); the report is `test-out/screenshots/report/summary.md` |
| `python3 scripts/check_comment.py [file...]` | Comment check on the given files, or on every tracked file |

## Tiers and time limits

| Tier | When | Time limit |
|---|---|---|
| Local check | After every change | 3 minutes |
| Pull request CI | Every push | 5 minutes |
| Nightly | Once a day | No fixed limit |

During development, run the unit tests plus the tests the change affects. CI runs the full PR tier; watch it and fix it when it turns red. Run the full suite locally only for large or risky changes, or for what CI cannot cover, such as performance measurements or screenshot comparisons at a milestone. Small gaps between tiers are acceptable; a large regression, and whatever is being fixed right now, must be tested in every tier.

Today CI runs `make check`, and on pull requests it also runs the screenshots job described below. Browser tests and nightly jobs are added by the tasks that need them. Performance jobs run alone, never in parallel with other heavy jobs.

## Rules for tests

- A test that prints a `FAIL` line, throws or exits non-zero is a failure and turns CI red.
- Never skip, disable or quarantine a test to get green. A known failure tracked elsewhere goes into an explicit list in the test file, named `knownFailures`, with the Issue Board task that fixes it; the entry is removed in the change that fixes it.
- Name tests by what they test, never by version or task number.
- Tests are isolated: temporary directories, no fixed ports, no global configuration or home directory, no dependence on network, DNS or machine load. Tests can run in parallel.
- A flaky test is a bug. Find the cause and fix it; do not rely on reruns.
- A noisy performance gate that fails on one row just past its threshold is rerun once before investigating.
- Every bug found by hand is first turned into an automated check when possible. Validate a new check by running it against the code before the fix and seeing it fail.

## Browsers

Browser tests use Playwright with the preinstalled Chromium in the cloud environment (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`); do not run `playwright install` there. Manual testing on macOS goes through Makefile targets, and those targets must keep working. On a Mac, run `npx playwright install chromium` once before the first `make screenshots`.

`playwright` is pinned to 1.56.1 because that version uses Chromium build 1194, the build installed in `/opt/pw-browsers`. Move the pin only together with the browser in the cloud environment.

## Screenshots in pull requests

Every pull request description has a Screenshots section that CI writes. The `screenshots` job in `.github/workflows/test.yml` runs on every push to a pull request from this repository:

1. `scripts/screenshots.sh HEAD^1` builds `examples/blog/` twice: from the pull request merged into its base branch, and from the base branch alone. For each build, `scripts/capture-pages.js` serves `dist/` on a free local port and takes a full-page screenshot of every HTML page in four variants: 1440 pixels wide and 375 pixels wide, each in the light and the dark color scheme.
2. `scripts/compare-screenshots.js` compares each pair of screenshots with pixelmatch and draws the images for the description with Playwright, each panel at its original pixel size with a label above it. For each changed screenshot it draws one image with the before, after and diff panels, cropped to the changed area plus 80 pixels on each side, at least 640 pixels wide and at most 800 pixels tall. Panels up to 440 pixels wide sit side by side; wider panels are stacked so that the text stays readable. A new or removed page is shown from the top. For every page it also draws the first screen of the desktop and the mobile variants. When the light and the dark variant give the same image, as they do while no dark styles exist, the image is drawn once and labeled with both. `summary.md` starts with the count of changed screenshots, followed by two collapsed sections: the changes, and the first screen of every page with one collapsed section per page and links to the full-page screenshots.
3. `scripts/publish-screenshots.sh` copies the report into `pr/<number>/<commit>/` on the `ci-screenshots` branch. That branch holds a single commit without parents. Each publish replaces it with a new commit that keeps the folders of other pull requests and replaces the folder of this pull request, so cloning the branch stays small. Only this CI job pushes to the branch.
4. The job writes the summary between `<!-- screenshots:start -->` and `<!-- screenshots:end -->` in the pull request description and leaves the rest of the description unchanged. Keep this section when you edit the description; if it is removed, the next push to the pull request adds it again.

The images link to `https://github.com/yhnocoder/bake/blob/ci-screenshots/pr/<number>/<commit>/...?raw=true`, so anyone who can read the repository sees them. A screenshot difference never fails CI; it is there for the author and the reviewer to look at.

Only pages of `examples/blog/` are captured. A change that should be visible needs a page in the example blog that shows it, and the pull request adds that page or that content when it is missing.

To look at the screenshots before pushing, run `make screenshots`. The report in `test-out/screenshots/report/` uses relative links, so `summary.md` opens in a Markdown preview, and `test-out/screenshots/head/` holds the full-page screenshots.
