# Testing

## Commands

| Command | What it runs |
|---|---|
| `make check` | `scripts/lint.sh` (comment check, shellcheck on shell scripts when installed), then the unit tests |
| `npm test` | Unit tests only (`node --test` on the files in `test/` that end in `.test.js`) |
| `npm run test:browser` | Browser tests (`node --test` on the files in `test/browser/` that end in `.test.js`), each test with a time limit of 120 seconds, so a test that never ends fails with its name |
| `make browser` | Installs the dependencies when needed, downloads Playwright's Chromium and runs the browser tests; use it on macOS |
| `make example` | Installs the dependencies when needed, builds `examples/blog/` and serves `examples/blog/dist/` at http://localhost:8000/ |
| `make dev` | Installs the dependencies when needed and runs `bake dev` in `examples/blog/`, which serves it at http://localhost:4321/ and updates the page on every save |
| `make screenshots [BASE=ref]` | Screenshots of every page of `examples/blog/` built from the working tree, compared with the same pages built from `BASE` (default `origin/main`); the report is `test-out/screenshots/report/summary.md` |
| `make perf` | Installs the dependencies when needed, builds `examples/blog/`, measures its pages with `scripts/measure-pages.js`, writes `test-out/perf/report.json` and checks it against `test/perf/budgets.json` |
| `node scripts/measure-pages.js <dist folder> [--out report.json]` | Measures every page of a built site except the 404 page, prints a table and writes the report as JSON when `--out` is given |
| `node scripts/check-budgets.js <report.json> [budgets.json]` | Checks a report against `test/perf/budgets.json` or the given budget file |
| `python3 scripts/check_comment.py [file...]` | Comment check on the given files, or on every tracked file |

## Tiers and time limits

| Tier | When | Time limit |
|---|---|---|
| Local check | After every change | 3 minutes |
| Pull request CI | Every push | 5 minutes |
| Nightly | Once a day | No fixed limit |

During development, run the unit tests plus the tests the change affects. CI runs the full PR tier; watch it and fix it when it turns red. Run the full suite locally only for large or risky changes, or for what CI cannot cover, such as performance measurements or screenshot comparisons at a milestone. Small gaps between tiers are acceptable; a large regression, and whatever is being fixed right now, must be tested in every tier.

`.github/workflows/test.yml` runs on every pull request, on every push to `main` and when started by hand. A push to another branch runs nothing until the branch has a pull request. A new push cancels the run of the same pull request or branch that is still going. The jobs run in parallel, each on its own runner with a time limit of 5 minutes:

| Job | What it runs |
|---|---|
| `lint` | `scripts/lint.sh`: the comment check and shellcheck |
| `unit` | The unit tests in two shards, `node --test --test-shard=1/2` and `2/2` |
| `browser` | The browser tests in three shards, `--test-shard=1/3` to `3/3` |
| `test` | Passes when `lint`, every `unit` shard and every `browser` shard passed; this is the check to read for the result of a run |
| `screenshots`, `publish-screenshots` | The screenshots in the pull request description, described below; pull requests only |

`node --test --test-shard=i/n` sorts the test files and gives shard `i` every `n`-th file, so a test file always runs whole on one runner and the slowest test file sets the shortest time its shard can take. The unit tests need Chromium too, because `bake build` draws share images with it. Every job except `lint` and `publish-screenshots` uses the composite action `.github/actions/setup`, which installs Node 24 with the npm cache, runs `npm ci` and installs Playwright's Chromium headless shell with its system libraries, keeping the browser in the Actions cache under the Playwright version. When a shard comes close to 5 minutes, add a shard in the matrix of its job and in the command. `.github/workflows/nightly.yml` runs the nightly tier once a day and when started by hand, described in "Performance measurements" below. Performance jobs run alone, never in parallel with other heavy jobs.

## Rules for tests

- A test that prints a `FAIL` line, throws or exits non-zero is a failure and turns CI red.
- Never skip, disable or quarantine a test to get green. A known failure tracked elsewhere goes into an explicit list in the test file, named `knownFailures`, with the Issue Board task that fixes it; the entry is removed in the change that fixes it.
- Name tests by what they test, never by version or task number.
- Tests are isolated: temporary directories, no fixed ports, no global configuration or home directory, no dependence on network, DNS or machine load. Tests can run in parallel.
- A flaky test is a bug. Find the cause and fix it; do not rely on reruns.
- A noisy performance gate that fails on one row just past its threshold is rerun once before investigating.
- Every bug found by hand is first turned into an automated check when possible. Validate a new check by running it against the code before the fix and seeing it fail.

## Browsers

Browser tests use Playwright with the preinstalled Chromium in the cloud environment (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`); do not run `playwright install` there. A browser test builds its blog into a temporary directory and serves `dist/` over HTTP on a free port with `serve` in `test/browser/server.js`, so the page loads its scripts and fonts the way a published site does. `serve` starts the static server in `scripts/static-server.js`, which the screenshot script uses too, and closes it when the test ends. The server then closes every connection that is still open, because Chromium can hold a connection on which it has not sent a request yet, and `server.close()` waits for such a connection. Like GitHub Pages, the server answers an address without a file with `dist/404.html` and status 404, and it sends `cache-control: max-age=600`, which GitHub Pages sends for every file, for the files in `dist/assets/`, whose names change with their content, so a test can check that a file the page downloaded in advance is read from the HTTP cache. With the option `gzip: true`, which only the performance measurement sets, it sends text files compressed with gzip to a browser that accepts it. The `playwright` version in `package.json` is pinned to the release that uses that Chromium build, so update both together. Manual testing on macOS goes through Makefile targets, and those targets must keep working. On macOS, `make browser` downloads Playwright's Chromium; run it once before the first `make check`, `make example` or `make screenshots`, because `bake build` draws share images with Chromium.

## Performance measurements

The nightly workflow has one job, `performance`, which runs alone on its runner. It sets up the runner with `.github/actions/setup`, builds `examples/blog/`, runs `scripts/measure-pages.js` on `examples/blog/dist/`, runs `scripts/check-budgets.js` on the report and uploads the report as the workflow artifact `performance-report`, also when the budget check fails. On the development machine the measurement takes about 2 minutes.

`scripts/measure-pages.js` serves the built site with `scripts/static-server.js` at `localhost`, where the AI chat appears, with `gzip: true`, so HTML, CSS, JavaScript, JSON, XML and SVG files are sent compressed with gzip as GitHub Pages sends them. It opens every HTML page except `404.html` in Chromium twice: 1440 by 900 pixels, and 375 by 812 pixels as a mobile device with touch. Each page and width gets a new browser context, so nothing is cached. Through the Chrome DevTools Protocol the page runs with `Emulation.setCPUThrottlingRate` at 4, so the CPU is 4 times slower, and with `Network.emulateNetworkConditions` set to the Fast 4G preset of Chrome DevTools: 9 Mbit/s down and 1.5 Mbit/s up, each multiplied by 0.9, and 60 milliseconds of round-trip time multiplied by 2.75, which is 165 milliseconds of latency. The script waits for the `load` event, for 500 milliseconds without requests, for the first contentful paint and for every component frame in the first screen to get `data-state="ready"` or `"failed"`. It then scrolls to the end of the page by 100 pixels every 100 milliseconds, which is 1000 pixels per second, waits again until no request is pending and every component frame on the page is ready or failed, and records:

| Metric | What it measures |
|---|---|
| `transferBytes` | Every byte transferred for the page after scrolling to its end, headers included, as `encodedDataLength` of the Chrome DevTools Protocol counts them |
| `firstScreenTransferBytes` | The bytes transferred before the script starts to scroll |
| `htmlBytes`, `cssBytes`, `imageBytes` | The bytes of the document, the stylesheets and the images |
| `themeScriptBytes` | The scripts that a classic `<script>` element of the page loads, and the scripts they import, apart from previews |
| `componentScriptBytes` | The component runtime, the module script `components-….js`, and every script it imports: the component chunks, `components/lib/`, Solid, the kit and MathJax |
| `chatScriptBytes` | The chat module, the module script `chat-….js`, and every script it imports |
| `previewScriptBytes` | Scripts outside `assets/` and the scripts they import, which are the `preview` modules that the homepage loads |
| `otherScriptBytes` | Scripts that none of these roots loaded |
| `fontBytes`, `fontFiles` | The bytes and the number of the font files |
| `firstContentfulPaintMs`, `largestContentfulPaintMs` | First Contentful Paint and Largest Contentful Paint from a `PerformanceObserver`, before the script scrolls |
| `firstScreenComponents` | The component frames that intersect the first screen |
| `componentsReadyMs` | The time from the start of the navigation until the last of those frames got `data-state="ready"` or `"failed"`, or `null` when the first screen has no component |
| `componentsBlankOnScroll` | The component frames that were in view without `data-state="ready"` while the script scrolled |
| `failedComponents`, `failedRequests` | The frames with `data-state="failed"`, and the requests that failed or got a status of 400 or more |

A script is assigned to the root of its chain of initiators that the Chrome DevTools Protocol reports. The report also lists every request of each page with its path, its type, its bytes and, for a script, its group, so a change of a metric can be traced to a file.

`test/perf/budgets.json` holds one limit per metric, which applies to every page and both widths, and states for each limit what it is based on. The limits on bytes and on font files are the largest value of two measurements of `examples/blog/` plus 20 percent; the byte counts do not change between runs. The limits on times are twice the largest measured time, because times vary by up to about 35 percent between runs on the same machine and the runners of GitHub Actions are slower than the development machine. `otherScriptBytes`, `componentsBlankOnScroll`, `failedComponents` and `failedRequests` have the limit 0. `firstScreenComponents` describes the page and has no limit. `scripts/check-budgets.js` prints one line for each exceeded limit, such as `/2026-10/syntax/ at 375 pixels: fontBytes is 1001, over the limit of 1000`, followed by the count, and exits with status 1. When a change makes a page larger or slower on purpose, the pull request raises the limit and rewrites its basis; a gap that stays is written down in "Clean code" in CONTRIBUTING.md together with who accepted it.

The `performance` job measures loading and scrolling. It records no frame times and no long tasks, so it does not check the 60 frames per second that every interaction and animation must reach.

## Screenshots in pull requests

Every pull request description has a Screenshots section that CI writes. Two jobs in `.github/workflows/test.yml` run on every push to a pull request from this repository. The `screenshots` job runs the pull request's code with a read-only token and uploads the report as a workflow artifact. The `publish-screenshots` job has write access, runs only the two publishing scripts below, and never installs dependencies or builds the blog.

1. `scripts/screenshots.sh HEAD^1` builds `examples/blog/` twice: from the pull request merged into its base branch, and from the base branch alone in a temporary git worktree. The script removes that worktree when it ends, also after an error or an interrupt. For each build, `scripts/capture-pages.js` serves `dist/` on a free local port with the static server of the browser tests, `scripts/static-server.js`, and takes a full-page screenshot of every HTML page in four variants: 1440 pixels wide and 375 pixels wide, each in the light and the dark color scheme. It serves the pages at `localhost`, where the AI chat appears, and on the first article page whose build has the chat it also opens the chat and takes a screenshot of the screen, named after the page with `-chat` added, and then takes the remaining screenshots in a new browser page, so the pointer that clicked the pet does not rest on the pet of the following pages.
2. `scripts/compare-screenshots.js` finds the changed areas of each pair of screenshots and draws the images for the description with Playwright. It compares the screenshots row by row with the `diff` library, so content inserted in the middle of a page is reported once and the content below it, which only moved down, is not. It first matches identical rows. Inside each group of differing rows it then also matches two rows when every color value of one lies between the smallest and the largest value of the 3 by 3 pixels around the same position in the other, give or take 16. Text that moved by a fraction of a pixel is drawn slightly differently, and this second step treats it as unchanged. A change confined to a single row is ignored, because a fractional height adds or removes one row and a fractional shift redraws one row of an underline or a dashed border differently. Differing rows less than 160 rows apart form one changed area. Each changed area becomes one image with a Before and an After panel, plus a Diff panel drawn by pixelmatch when the changed rows have the same height before and after. The panels are cropped to the changed rows and the columns that differ in them, plus 80 pixels on each side, at least 640 pixels wide and at most 1200 pixels tall; at most four areas are drawn for one screenshot. The images have a white background, a thin border around each panel and a label above it. Every image is at most 880 pixels wide, the width of the description column on GitHub. Panels sit side by side while they fit in that width at their original size, and are stacked otherwise; a panel wider than 872 pixels is scaled down to fit and is never cut. A new or removed page is shown from the top. For every page it also draws the first screen of the desktop and the mobile variants, cropped to the viewport. When the light and the dark variant give the same image, as they do while no dark styles exist, the image is drawn once and labeled with both. `summary.md` starts with the count of changed screenshots, followed by two collapsed sections: the changes, and the first screen of every page with one collapsed section per page and links to the full-page screenshots.
3. `scripts/publish-screenshots.sh` copies the report into `pr/<number>/<commit>/` on the `ci-screenshots` branch. That branch holds a single commit without parents. Each publish replaces it with a new commit that keeps the folders of other pull requests and replaces the folder of this pull request, so cloning the branch stays small. Only the `publish-screenshots` job pushes to the branch.
4. `scripts/screenshot-section.js` writes the summary between `<!-- screenshots:start -->` and `<!-- screenshots:end -->` in the pull request description and leaves the rest of the description unchanged. Keep this section when you edit the description; if it is removed, the next push to the pull request adds it again.

The images link to `https://github.com/yhnocoder/bake/blob/ci-screenshots/pr/<number>/<commit>/...?raw=true`, so anyone who can read the repository sees them. A screenshot difference never fails CI; it is there for the author and the reviewer to look at.

Only pages of `examples/blog/` are captured. A change that should be visible needs a page in the example blog that shows it, and the pull request adds that page or that content when it is missing.

To look at the screenshots before pushing, run `make screenshots`. The report in `test-out/screenshots/report/` uses relative links, so `summary.md` opens in a Markdown preview, and `test-out/screenshots/head/` holds the full-page screenshots.
