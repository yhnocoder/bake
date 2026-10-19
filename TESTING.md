# Testing

## Commands

| Command | What it runs |
|---|---|
| `make check` | Comment check, shellcheck on shell scripts (when installed), unit tests |
| `npm test` | Unit tests only (`node --test` on the files in `test/` that end in `.test.js`) |
| `make example` | Installs the dependencies when needed, builds `examples/blog/` and serves `examples/blog/dist/` at http://127.0.0.1:8000/ |
| `python3 scripts/check_comment.py [file...]` | Comment check on the given files, or on every tracked file |

## Tiers and time limits

| Tier | When | Time limit |
|---|---|---|
| Local check | After every change | 3 minutes |
| Pull request CI | Every push | 5 minutes |
| Nightly | Once a day | No fixed limit |

During development, run the unit tests plus the tests the change affects. CI runs the full PR tier; watch it and fix it when it turns red. Run the full suite locally only for large or risky changes, or for what CI cannot cover, such as performance measurements or screenshot comparisons at a milestone. Small gaps between tiers are acceptable; a large regression, and whatever is being fixed right now, must be tested in every tier.

Today CI runs `make check`. Browser tests and nightly jobs are added by the tasks that need them. Performance jobs run alone, never in parallel with other heavy jobs.

## Rules for tests

- A test that prints a `FAIL` line, throws or exits non-zero is a failure and turns CI red.
- Never skip, disable or quarantine a test to get green. A known failure tracked elsewhere goes into an explicit list in the test file, named `knownFailures`, with the Issue Board task that fixes it; the entry is removed in the change that fixes it.
- Name tests by what they test, never by version or task number.
- Tests are isolated: temporary directories, no fixed ports, no global configuration or home directory, no dependence on network, DNS or machine load. Tests can run in parallel.
- A flaky test is a bug. Find the cause and fix it; do not rely on reruns.
- A noisy performance gate that fails on one row just past its threshold is rerun once before investigating.
- Every bug found by hand is first turned into an automated check when possible. Validate a new check by running it against the code before the fix and seeing it fail.

## Browsers

Browser tests use Playwright with the preinstalled Chromium in the cloud environment (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`); do not run `playwright install` there. Manual testing on macOS goes through Makefile targets, and those targets must keep working.
