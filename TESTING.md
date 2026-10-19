# Testing

## Commands

| Command | What it runs |
|---|---|
| `make check` | Comment check, shellcheck on shell scripts (when installed), unit tests |
| `npm test` | Unit tests only (`node --test` on the files in `test/` that end in `.test.js`) |
| `npm run test:browser` | Browser tests (`node --test` on the files in `test/browser/` that end in `.test.js`), each test with a time limit of 120 seconds, so a test that never ends fails with its name |
| `make browser` | Installs the dependencies when needed, downloads Playwright's Chromium and runs the browser tests; use it on macOS |
| `make example` | Installs the dependencies when needed, builds `examples/blog/` and serves `examples/blog/dist/` at http://localhost:8000/ |
| `make dev` | Installs the dependencies when needed and runs `bake dev` in `examples/blog/`, which serves it at http://localhost:4321/ and updates the page on every save |
| `make screenshots [BASE=ref]` | Screenshots of every page of `examples/blog/` built from the working tree, compared with the same pages built from `BASE` (default `origin/main`); the report is `test-out/screenshots/report/summary.md` |
| `python3 scripts/check_comment.py [file...]` | Comment check on the given files, or on every tracked file |

## Tiers and time limits

| Tier | When | Time limit |
|---|---|---|
| Local check | After every change | 3 minutes |
| Pull request CI | Every push | 5 minutes |
| Nightly | Once a day | No fixed limit |

During development, run the unit tests plus the tests the change affects. CI runs the full PR tier; watch it and fix it when it turns red. Run the full suite locally only for large or risky changes, or for what CI cannot cover, such as performance measurements or screenshot comparisons at a milestone. Small gaps between tiers are acceptable; a large regression, and whatever is being fixed right now, must be tested in every tier.

Today CI installs Playwright's Chromium, runs `make check` and then `npm run test:browser`. The unit tests need Chromium too, because `bake build` draws share images with it. On pull requests it also runs the two screenshots jobs described below. Nightly jobs are added by the tasks that need them. Performance jobs run alone, never in parallel with other heavy jobs.

## Rules for tests

- A test that prints a `FAIL` line, throws or exits non-zero is a failure and turns CI red.
- Never skip, disable or quarantine a test to get green. A known failure tracked elsewhere goes into an explicit list in the test file, named `knownFailures`, with the Issue Board task that fixes it; the entry is removed in the change that fixes it.
- Name tests by what they test, never by version or task number.
- Tests are isolated: temporary directories, no fixed ports, no global configuration or home directory, no dependence on network, DNS or machine load. Tests can run in parallel.
- A flaky test is a bug. Find the cause and fix it; do not rely on reruns.
- A noisy performance gate that fails on one row just past its threshold is rerun once before investigating.
- Every bug found by hand is first turned into an automated check when possible. Validate a new check by running it against the code before the fix and seeing it fail.

## Browsers

Browser tests use Playwright with the preinstalled Chromium in the cloud environment (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`); do not run `playwright install` there. A browser test builds its blog into a temporary directory and serves `dist/` over HTTP on a free port with `test/browser/server.js`, so the page loads its scripts and fonts the way a published site does. When the test ends, the server closes every connection that is still open, because Chromium can hold a connection on which it has not sent a request yet, and `server.close()` waits for such a connection. Like GitHub Pages, the server answers an address without a file with `dist/404.html` and status 404. The `playwright` version in `package.json` is pinned to the release that uses that Chromium build, so update both together. Manual testing on macOS goes through Makefile targets, and those targets must keep working. On macOS, `make browser` downloads Playwright's Chromium; run it once before the first `make check`, `make example` or `make screenshots`, because `bake build` draws share images with Chromium.

## Screenshots in pull requests

Every pull request description has a Screenshots section that CI writes. Two jobs in `.github/workflows/test.yml` run on every push to a pull request from this repository. The `screenshots` job runs the pull request's code with a read-only token and uploads the report as a workflow artifact. The `publish-screenshots` job has write access, runs only the two publishing scripts below, and never installs dependencies or builds the blog.

1. `scripts/screenshots.sh HEAD^1` builds `examples/blog/` twice: from the pull request merged into its base branch, and from the base branch alone in a temporary git worktree. The script removes that worktree when it ends, also after an error or an interrupt. For each build, `scripts/capture-pages.js` serves `dist/` on a free local port and takes a full-page screenshot of every HTML page in four variants: 1440 pixels wide and 375 pixels wide, each in the light and the dark color scheme. It serves the pages at `localhost`, where the AI chat appears, and on the first article page whose build has the chat it also opens the chat panel and takes a screenshot of the screen, named after the page with `-chat` added.
2. `scripts/compare-screenshots.js` finds the changed areas of each pair of screenshots and draws the images for the description with Playwright. It compares the screenshots row by row with the `diff` library, so content inserted in the middle of a page is reported once and the content below it, which only moved down, is not. It first matches identical rows. Inside each group of differing rows it then also matches two rows when every color value of one lies between the smallest and the largest value of the 3 by 3 pixels around the same position in the other, give or take 16. Text that moved by a fraction of a pixel is drawn slightly differently, and this second step treats it as unchanged. A change confined to a single row is ignored, because a fractional height adds or removes one row and a fractional shift redraws one row of an underline or a dashed border differently. Differing rows less than 160 rows apart form one changed area. Each changed area becomes one image with a Before and an After panel, plus a Diff panel drawn by pixelmatch when the changed rows have the same height before and after. The panels are cropped to the changed rows and the columns that differ in them, plus 80 pixels on each side, at least 640 pixels wide and at most 1200 pixels tall; at most four areas are drawn for one screenshot. The images have a white background, a thin border around each panel and a label above it. Every image is at most 880 pixels wide, the width of the description column on GitHub. Panels sit side by side while they fit in that width at their original size, and are stacked otherwise; a panel wider than 872 pixels is scaled down to fit and is never cut. A new or removed page is shown from the top. For every page it also draws the first screen of the desktop and the mobile variants, cropped to the viewport. When the light and the dark variant give the same image, as they do while no dark styles exist, the image is drawn once and labeled with both. `summary.md` starts with the count of changed screenshots, followed by two collapsed sections: the changes, and the first screen of every page with one collapsed section per page and links to the full-page screenshots.
3. `scripts/publish-screenshots.sh` copies the report into `pr/<number>/<commit>/` on the `ci-screenshots` branch. That branch holds a single commit without parents. Each publish replaces it with a new commit that keeps the folders of other pull requests and replaces the folder of this pull request, so cloning the branch stays small. Only the `publish-screenshots` job pushes to the branch.
4. `scripts/screenshot-section.js` writes the summary between `<!-- screenshots:start -->` and `<!-- screenshots:end -->` in the pull request description and leaves the rest of the description unchanged. Keep this section when you edit the description; if it is removed, the next push to the pull request adds it again.

The images link to `https://github.com/yhnocoder/bake/blob/ci-screenshots/pr/<number>/<commit>/...?raw=true`, so anyone who can read the repository sees them. A screenshot difference never fails CI; it is there for the author and the reviewer to look at.

Only pages of `examples/blog/` are captured. A change that should be visible needs a page in the example blog that shows it, and the pull request adds that page or that content when it is missing.

To look at the screenshots before pushing, run `make screenshots`. The report in `test-out/screenshots/report/` uses relative links, so `summary.md` opens in a Markdown preview, and `test-out/screenshots/head/` holds the full-page screenshots.
