# Testing

## Commands

| Command | What it runs |
|---|---|
| `make check` | Installs the dependencies when needed, runs `scripts/lint.sh` (shellcheck on the shell scripts when it is installed), then the unit tests |
| `npm test` | The unit tests, the files in `test/` that end in `.test.js` |
| `npm run test:browser` | The browser tests, the files in `test/browser/` that end in `.test.js`, each test with a time limit of 120 seconds |
| `npm run test:frames` | The frame time gate in `test/frames/`; with `BAKE_FRAMES=all` it measures every interaction |
| `make browser` | Installs the dependencies when needed, downloads Playwright's Chromium and runs the browser tests |
| `make perf` | Builds `examples/blog/`, measures its pages and checks them against the performance budgets |
| `make example` | Builds `examples/blog/` and serves `examples/blog/dist/` at the `localhost` address it prints |
| `make dev` | Runs `bake dev` in `examples/blog/` |

`bake build` draws share images with Chromium, so the unit tests need Playwright's Chromium too. On macOS, run `make browser` once to download it. In the cloud environment Chromium is preinstalled at `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; do not run `playwright install` there. The `playwright` version in `package.json` is pinned to the release that uses that Chromium build, so update both together.

## Tiers

| Tier | When | Time limit |
|---|---|---|
| Local check | After a change to code: the tests of the changed features | 3 minutes |
| Pull request CI | Every push to a pull request or to `main` | 5 minutes per job |
| Nightly | Once a day | 30 minutes per job |

`.github/workflows/test.yml` runs on every pull request, on every push to `main` and when started by hand; a new push cancels the run that is still going for the same pull request or branch. Its jobs `lint`, `unit` (two shards), `browser` (three shards) and `frames` run in parallel, and the job `test` passes when all of them passed, so `test` is the check to read. `node --test --test-shard` runs each test file whole on one shard; when a shard comes close to its time limit, add a shard to the matrix and to the command. The jobs that run tests set up Node, the dependencies and Chromium with `.github/actions/setup`.

`.github/workflows/nightly.yml` runs once a day and when started by hand. Its job `performance` measures the pages of the example blog and checks the budgets, and its job `frames` runs the frame time gate with `BAKE_FRAMES=all`.

## Rules for tests

- A test that prints a `FAIL` line, throws or exits with a non-zero status is a failure.
- Never skip, disable or quarantine a test to get green. A known failure goes into a list named `knownFailures` in the test file, with the task or issue that fixes it; the change that fixes it removes the entry.
- Name tests by what they test, never by version or task number.
- Tests are isolated: temporary directories, free ports, no global configuration or home directory, no dependence on the network, DNS or machine load. Tests can run in parallel.
- A flaky test is a bug. Find the cause and fix it; do not rely on reruns.
- A noisy performance gate that fails on one case just past its limit is rerun once before investigating.
- A bug found by hand first becomes an automated check when possible. Validate the check by running it against the code before the fix and seeing it fail.

## Test suites

**Unit tests** (`test/*.test.js`) run the CLI and the build on blogs created in temporary directories and on a copy of `examples/blog/`, and check the output files and the reported problems.

**Browser tests** (`test/browser/`) build a blog into a temporary directory, serve its `dist/` over HTTP on a free port and drive it with Playwright, so the page loads its scripts and fonts as a published site does. `test/browser/browser.js` serves a folder or the built example blog, launches one Chromium per test file and waits until a page has settled: its fonts are loaded and its animations have finished. The server, `scripts/static-server.js`, answers like GitHub Pages: `404.html` with status 404 for a missing file, and `cache-control: max-age=600` for the files in `assets/`. It serves at `127.0.0.1`, or at `localhost` when the test needs the AI chat, which appears only there.

**Frame time gate** (`test/frames/`) opens pages of the example blog in Chromium with the CPU slowed down, records the frame times while Playwright performs an interaction, and fails when too many frames are slow or dropped, when one frame is too long, when the page throws or when a component enters the viewport before it is ready. The limits, the slowdown and the screen sizes are in `test/frames/frames.js`; the interactions, and which of them run only in the nightly tier, are in `test/frames/frames.test.js`. A case listed in `knownFailures` reports its numbers and is marked as a todo instead of failing.

**Performance budgets.** `scripts/measure-pages.js` loads and scrolls every page of a built site in Chromium with a slowed CPU and network and writes the bytes, paint times and component states per page and screen width; the settings and the metrics are defined at the top of the script. `scripts/check-budgets.js` checks the report against `test/perf/budgets.json`, which holds one limit per metric with the basis of each limit. A change that makes pages larger or slower on purpose raises the limit and rewrites its basis in the same change.
