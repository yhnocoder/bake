# Testing

## What a test checks

A test is one of three kinds:

1. **A promise of README.md.** It writes the smallest blog that the promise needs, runs Bake or opens the page, and checks what the user or the reader observes. Its name says the promise.
2. **An invariant of every page of the example blog.** `test/browser/pages.test.js` opens each page of `examples/blog/`, the homepage, every article, the plain HTML page and the 404 page, and checks the same properties on each: see [Invariants and tables](#invariants-and-tables).
3. **A performance budget.** A limit in `test/perf/budgets.json` on a quantity that a reader or an author waits for or downloads.

A check that is none of these is not written. Visual details that README.md does not promise, such as shadows, cursors, colours, radii and the curves of transitions, have no tests.

Each promise has one test. Before writing a test, look for the test of the promise and extend it; a check that applies to every page, every kind of blog file or every reader setting goes into one of the tables below instead of a test of its own.

## Invariants and tables

Three places check one property for every item of a list, so that a new item is checked by adding a row, not a test:

| Where | Each item | What is checked |
|---|---|---|
| `test/browser/pages.test.js` | Each page of the example blog | At the breakpoints 1440, 1340, 1339, 1000, 600 and 375 pixels: no console error, no failed request, every component starts, every formula renders, no repeated id and the page is not wider than the screen. In the dark scheme the page loads without errors, every component starts and the page is darker than in the light scheme. The bytes and requests of the first screen stay within the budgets. For each Markdown article, copying each whole block gives its source lines |
| `test/site.test.js` | Each kind of blog file that README.md lists | After a change of the file, the site that `bake dev` updates has the same pages, assets and problems as a build from scratch |
| `test/browser/reader-settings.test.js` | Each reader setting | The setting changes the page at once, survives a reload, is applied before the page script runs and can be chosen back |

An article added to the example blog is checked by the invariants without a change of the test. The invariants read the structure of the example blog, its page addresses and the line numbers of its blocks, and never its sentences, so that a change of the text of an example article breaks no test. A test of a promise writes its own blog.

## Commands

| Command | What it runs |
|---|---|
| `node --test --watch test/markdown.test.js` | The unit tests of one feature, again on each save of a file they load |
| `npx playwright test test/browser/toc.test.js` | The browser tests of one file; `-g <text>` runs the tests whose names contain the text |
| `make check` | Installs the dependencies when needed, runs `scripts/lint.sh` (shellcheck on the shell scripts when it is installed), then the unit tests |
| `npm test` | The unit tests, the files in `test/` that end in `.test.js` |
| `npm run test:browser` | The browser tests, the files in `test/browser/` that end in `.test.js`, with Playwright Test, one worker per processor and each test with a time limit of 60 seconds |
| `make browser` | Installs the dependencies when needed, downloads Playwright's Chromium and runs the browser tests |
| `make perf` | Builds `examples/blog/`, measures the paint times of its pages and checks them against the performance budgets |
| `make perf-dev` | Measures `bake build`, `bake new` and `bake dev` on a copy of `examples/blog/` and checks them against the performance budgets |
| `make example` | Runs `bake preview` in `examples/blog/`, which builds it and serves `examples/blog/dist/` at the `localhost` address it prints |
| `make dev` | Runs `bake dev` in `examples/blog/` |

`bake build` draws share images with Chromium, so the unit tests need Playwright's Chromium too. On macOS, run `make browser` once to download it. In the cloud environment Chromium is preinstalled at `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; do not run `playwright install` there. The `playwright` version in `package.json` is pinned to the release that uses that Chromium build, and the jobs of the workflows run in the container `mcr.microsoft.com/playwright` of the same release, so update all three together.

## When each test runs

| When | What runs | Time limit |
|---|---|---|
| While changing code | `node --test --watch` on the unit test file of the feature | A few seconds per run |
| After a change to a page script or a style | `npx playwright test` on the browser test files of the feature | 1 minute |
| Before a push | `make check` | 1 minute on 4 processors |
| Every push to a pull request or to `main` | The workflow `test` | 5 minutes per job |
| Once a day | The workflow `nightly` | 30 minutes per job |

Running all unit tests takes most of a minute because each test file starts its own process and loads the build modules, and a few files start the CLI, `bake dev` or Chromium. Selecting tests from the changed files does not work, because most test files build a blog and so load nearly every module of `src/`. The fast loop is therefore one feature file at a time.

`.github/workflows/test.yml` runs on every pull request, on every push to `main` and when started by hand; a new push cancels the run that is still going for the same pull request or branch. Its jobs `lint`, `unit` and `browser` (three shards) run in parallel, and the job `test` passes when all of them passed, so `test` is the check to read. `playwright test --shard` divides the browser tests one by one; when a shard comes close to its time limit, add a shard to the matrix and to the command. When `unit` comes close to its time limit, split it into shards with `node --test --test-shard`, which runs each test file whole on one shard. A failed `browser` job uploads the Playwright trace of each failed test as an artifact; `npx playwright show-trace <trace.zip>` replays it. The jobs that run tests on Linux run in Playwright's container image, which holds Chromium and the system libraries it needs, and set `PLAYWRIGHT_BROWSERS_PATH` to its browsers; `.github/actions/setup` then installs Node and the dependencies, and on macOS it also installs Chromium.

`.github/workflows/nightly.yml` runs once a day and when started by hand. Its job `performance` measures the paint times of the pages of the example blog, its job `dev` measures `bake build`, `bake new` and `bake dev`, and both check the budgets. Its job `repeat` runs the browser tests three times on twice as many workers as processors, which finds tests that depend on timing. Its job `macos` runs the unit and the browser tests on macOS. When a scheduled run fails, the job `report` opens an issue, or comments on the one that is open.

## Performance budgets

`test/perf/budgets.json` holds one limit per metric with the basis of each limit.

The quantities that are the same on every machine are checked on every pull request. `test/browser/pages.test.js` reads the gzip size of the HTML, the CSS and the scripts of the theme, the components, the chat and the previews that each page loads before the reader does anything, and the number of its requests. `test/layers.test.js` checks that `bake new` and `bake init` load only the packages that read the configuration and write files. `test/site.test.js` counts the articles that an update reads again, and `test/browser/layout.test.js` counts the layouts that placing the blocks forces.

Times vary between runs and machines, so they are measured only in the nightly workflow, with limits of twice the value measured on its runner. `scripts/measure-pages.js` loads and scrolls every page of a built site in Chromium and writes the paint times and component states per page and screen width; the settings and the metrics are defined at the top of the script. `scripts/measure-dev.js` times `bake build` and `bake new` on a copy of `examples/blog/`, and the start of `bake dev` and, on three articles, the time from saving an article, a component and `bake.config.js` until the changed text is visible in Chromium; its edits add text of their own to its copy. `scripts/check-budgets.js` checks either report against `test/perf/budgets.json`.

A change that makes pages larger or slower on purpose raises the limit and rewrites its basis in the same change.

## Rules for tests

- A test that prints a `FAIL` line, throws or exits with a non-zero status is a failure.
- Assert what a reader would notice, as a relation: a box inside the screen, two gutters of equal width, a dark background darker than the light one, a page that looks like a reference page. Compare with a value that the test reads from the page or from a reference, such as a CSS variable of the theme or the same page without scripts, instead of a pixel position or a colour written into the test. Problems that Bake reports, copied Markdown and other text that a user reads stay exact, because they are the interface.
- An animation lasts a fraction of a second, which a loaded machine can let pass before the test looks. Record every frame of it in the page, or pause it when it starts, instead of looking once after the action. The same holds for anything shown for a limited time, such as a toast. There is no test of frame times; the performance budgets measure the speed of pages.
- Never skip, disable or quarantine a test to get green. A known failure goes into a list named `knownFailures` in the test file, with the task or issue that fixes it; the change that fixes it removes the entry.
- Name tests by what they test, never by version or task number.
- Tests are isolated: temporary directories, free ports, no global configuration or home directory, no dependence on the network, DNS or machine load. Tests can run in parallel.
- A test stays within 60 seconds on a loaded machine. A test that needs longer is split, never marked slow.
- A flaky test is a bug. Find the cause and fix it; do not rely on reruns.
- A noisy performance gate that fails on one case just past its limit is rerun once before investigating.
- A bug found by hand becomes an automated check only when it is likely to happen again. Validate a new check by running it against the code before the fix, or against the code with the promise broken by hand, and seeing it fail.

## Test suites

**Unit tests** (`test/*.test.js`) build blogs created in temporary directories and copies of `examples/blog/`, and check the output files and the reported problems. They call the build in the test process; only the tests of the command line itself, such as `test/cli.test.js`, start the CLI. `builtExample()` and `builtBlog()` in `test/blog.js` keep a built blog in the temporary folder under the hash of its files and of `src/`, so a run after a change that leaves a blog unchanged does not build it again.

**Browser tests** (`test/browser/`) build a blog, serve its `dist/` over HTTP on a free port and drive it with Playwright Test, so the page loads its scripts and fonts as a published site does. A browser test checks what happens after the page loads: layout, page scripts, keyboard and pointer, the clipboard and the updates of `bake dev`. What a built file contains is checked by the unit tests. `test/browser/browser.js` defines the fixtures: the option `blog` chooses the example blog, the files added to it or a blog of its own files, and whether it is served at `localhost`; `page`, `newPage` and `newContext` open pages at the address of that blog; `startDev` runs `bake dev` on a folder; `settle` waits until a page has settled: its fonts are loaded and its animations have finished. A blog is built once per content hash, like the blogs of the unit tests, and each worker serves it once. The server, `src/dev/static-server.js`, which `bake preview` uses too, answers like GitHub Pages: `404.html` with status 404 for a missing file, and `cache-control: max-age=600` for the files in `assets/`. It serves at `127.0.0.1`, or at `localhost` when the test needs the AI chat, which appears only there.
