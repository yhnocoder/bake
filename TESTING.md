# Testing

## Commands

| Command | What it runs |
|---|---|
| `make check` | Installs the dependencies when needed, runs `scripts/lint.sh` (shellcheck on the shell scripts when it is installed), then the unit tests |
| `npm test` | The unit tests, the files in `test/` that end in `.test.js` |
| `npm run test:browser` | The browser tests, the files in `test/browser/` that end in `.test.js`, with Playwright Test, one worker per processor and each test with a time limit of 60 seconds |
| `npx playwright test test/browser/toc.test.js` | The browser tests of one file; `-g <text>` runs the tests whose names contain the text |
| `make browser` | Installs the dependencies when needed, downloads Playwright's Chromium and runs the browser tests |
| `make perf` | Builds `examples/blog/`, measures its pages and checks them against the performance budgets |
| `make perf-dev` | Measures `bake dev` on a copy of `examples/blog/` and checks it against the performance budgets |
| `make example` | Runs `bake preview` in `examples/blog/`, which builds it and serves `examples/blog/dist/` at the `localhost` address it prints |
| `make dev` | Runs `bake dev` in `examples/blog/` |

`bake build` draws share images with Chromium, so the unit tests need Playwright's Chromium too. On macOS, run `make browser` once to download it. In the cloud environment Chromium is preinstalled at `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; do not run `playwright install` there. The `playwright` version in `package.json` is pinned to the release that uses that Chromium build, so update both together.

## Tiers

| Tier | When | Time limit |
|---|---|---|
| Local check | After a change to code: the tests of the changed features | 3 minutes |
| Pull request CI | Every push to a pull request or to `main` | 5 minutes per job |
| Nightly | Once a day | 30 minutes per job |

`.github/workflows/test.yml` runs on every pull request, on every push to `main` and when started by hand; a new push cancels the run that is still going for the same pull request or branch. Its jobs `lint`, `unit` (two shards) and `browser` (three shards) run in parallel, and the job `test` passes when all of them passed, so `test` is the check to read. `node --test --test-shard` runs each unit test file whole on one shard, and `playwright test --shard` divides the browser tests one by one; when a shard comes close to its time limit, add a shard to the matrix and to the command. A failed `browser` job uploads the Playwright trace of each failed test as an artifact; `npx playwright show-trace <trace.zip>` replays it. The jobs that run tests set up Node, the dependencies and Chromium with `.github/actions/setup`.

`.github/workflows/nightly.yml` runs once a day and when started by hand. Its job `performance` measures the pages of the example blog and checks the budgets, its job `dev` measures `bake dev` and checks the budgets, and its job `macos` runs the unit and the browser tests on macOS.

## Rules for tests

- A test that prints a `FAIL` line, throws or exits with a non-zero status is a failure.
- Assert what a reader would notice, as a relation: a box inside the screen, two gutters of equal width, a dark background darker than the light one, a page that looks like a reference page. Compare with a value that the test reads from the page or from a reference, such as a CSS variable of the theme or the same page without scripts, instead of a pixel position or a colour written into the test. Problems that Bake reports, copied Markdown and other text that a user reads stay exact, because they are the interface.
- An animation lasts a fraction of a second, which a loaded machine can let pass before the test looks. Record every frame of it in the page, or pause it when it starts, instead of looking once after the action. There is no test of frame times; the performance budgets measure the speed of pages.
- Never skip, disable or quarantine a test to get green. A known failure goes into a list named `knownFailures` in the test file, with the task or issue that fixes it; the change that fixes it removes the entry.
- Name tests by what they test, never by version or task number.
- Tests are isolated: temporary directories, free ports, no global configuration or home directory, no dependence on the network, DNS or machine load. Tests can run in parallel.
- A flaky test is a bug. Find the cause and fix it; do not rely on reruns.
- A noisy performance gate that fails on one case just past its limit is rerun once before investigating.
- A bug found by hand becomes an automated check only when it is likely to happen again. Validate the check by running it against the code before the fix and seeing it fail.

## Test suites

**Unit tests** (`test/*.test.js`) build blogs created in temporary directories and copies of `examples/blog/`, and check the output files and the reported problems. They call the build in the test process; only the tests of the commands, such as `test/cli.test.js`, start the CLI. `builtExample()` and `builtBlog()` in `test/blog.js` keep a built blog in the temporary folder under the hash of its files and of `src/`, so a run after a change that leaves a blog unchanged does not build it again.

**Browser tests** (`test/browser/`) build a blog, serve its `dist/` over HTTP on a free port and drive it with Playwright Test, so the page loads its scripts and fonts as a published site does. `test/browser/browser.js` defines the fixtures: the option `blog` chooses the example blog, the files added to it or a blog of its own files, and whether it is served at `localhost`; `page`, `newPage` and `newContext` open pages at the address of that blog; `startDev` runs `bake dev` on a folder; `settle` waits until a page has settled: its fonts are loaded and its animations have finished. A blog is built once per content hash, like the blogs of the unit tests, and each worker serves it once. The server, `src/dev/static-server.js`, which `bake preview` uses too, answers like GitHub Pages: `404.html` with status 404 for a missing file, and `cache-control: max-age=600` for the files in `assets/`. It serves at `127.0.0.1`, or at `localhost` when the test needs the AI chat, which appears only there.

**Performance budgets.** `scripts/measure-pages.js` loads and scrolls every page of a built site in Chromium and writes the bytes, paint times and component states per page and screen width; the settings and the metrics are defined at the top of the script. `scripts/measure-dev.js` starts `bake dev` on a copy of `examples/blog/` and writes the median time until the homepage answers and, on three articles, the median time from saving an article, a component and `bake.config.js` until the changed text is visible in Chromium; it runs only in the nightly tier, because these times vary too much between runs. `scripts/check-budgets.js` checks either report against `test/perf/budgets.json`, which holds one limit per metric with the basis of each limit. A change that makes pages larger or slower on purpose raises the limit and rewrites its basis in the same change.
