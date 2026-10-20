# Cleanup plan

The project works but has grown hard to control. This plan simplifies code, tests and documentation in ordered steps on the branch `invest/overall`. Each step is done by one subagent, ends with one or more commits on this branch and is verified before the next step starts. Nothing is pushed and no pull request is opened.

## Decisions

Kept as features: the AI chat with pets (including the 30-day "remember" of the chat key), the four table of contents styles and the reader settings, copying as Markdown, the bento theme, the frame time gate and the performance budgets, share images, theme overrides, CHANGELOG.md and the npm publishing setup.

Removed: the screenshot comparison tooling, and the in-place partial update of `bake dev` (replaced by a full page reload that keeps the scroll position).

Documentation:
- There is no developer documentation. Rules live in CLAUDE.md; knowledge the code cannot express goes into a code comment next to the code.
- README.md is documentation for people who use bake to write a blog. It describes the public interface (installation, commands, configuration, writing syntax, components, themes) and must match the code.
- TESTING.md only says how to run the tests and how the tests are designed. It does not restate constants from code.

Tests test behavior, not implementation. They cover what a user of bake or a reader of a blog can observe, and enough of it to catch regressions. A test is added only when it guards a behavior no other test guards.

## Environment

Playwright's pinned Chromium (build 1194, the one CI uses) is installed locally, so tests and measurements run with plain `chromium.launch()`. The installed Google Chrome is a fallback (`channel: 'chrome'`) if that build stops working.

Verification is sized to the change: a change to documentation only runs no tests; a change to one feature runs the unit and browser tests of that feature; a change to shared code (build, theme layer, test helpers) runs `npm test` and the full browser suite. The full browser suite also runs at the end of steps 3, 6 and 7.

## Steps

### 0. Baseline measurements

Before any change, measure commit `2465439` on this machine and keep the results in the scratchpad (`perf/baseline.json`), with the scripts that produced them, so step 8 runs the same scripts.
- `bake dev` startup: from spawning the process to the first successful response for the homepage, on a copy of `examples/blog/`. Median of 5 runs.
- Hot update: from writing a changed article file to the page in the browser showing the new text, for an article edit, a component edit and a config edit. Median of 5 runs each. The mechanism changes in step 2, so the measure is the time until the new content is visible.
- Frame rate of the built pages: `npm run test:frames` with `BAKE_FRAMES=all`, plus scrolling and dragging a component control on `llm-act-fns` and `matrix-calculus`, per case: frame count and median frame time. 3 runs at normal CPU speed, which the final comparison uses, and 3 runs with the gate's 2x CPU slowdown.

This cleanup compares medians only. The baseline showed a median frame time of 16.7 ms, one display refresh, in every case at both CPU speeds, so the final table also lists the share of dropped frames per case as information; it does not set a target for this cleanup. The 95th percentile, the longest frames and the known slow cases are left to a later optimization phase.

### 1. Rules and documentation

- Rewrite CLAUDE.md as short rules. Remove the rule against comments and allow a comment where the code cannot carry the knowledge. Remove rules nothing implements (the `Tests:` line in pull requests). Make the commit rule match one convention. Allow non-English text in the example blog content and in localized interface labels.
- Delete `scripts/check_comment.py`, `test/check-comment.test.js` and the comment check in `scripts/lint.sh`.
- Shrink TESTING.md to how to run the tests and how they are designed.
- Remove every reference to CONTRIBUTING.md (README.md, TESTING.md, CLAUDE.md).
- Drop the accepted gaps that no longer matter; a gap that still matters becomes a `knownFailures` entry or a code comment.
- README.md: fix it to match the code, including the chat key, which is remembered for 30 days (`src/chat/vault.js`). Add what a user needs and is missing: installation and the Node version, the component interface (`params`, `layout`, default export, `bake/kit`), and the complete list of files a theme must provide.
- Bring CHANGELOG.md up to date with the user-visible changes after #111.
- `make check` depends on `node_modules`. `make example` serves with `scripts/static-server.js`.

### 2. Removals

- Delete the screenshot comparison: `scripts/screenshots.sh`, `scripts/capture-pages.js`, `scripts/compare-screenshots.js`, `scripts/screenshot-variants.js` (move the viewport sizes that other files need into one place), `test/compare-screenshots.test.js`, the Makefile target and the dependencies only it used.
- Replace the partial update of `bake dev` with a full page reload that keeps the scroll position: delete `src/dev/client/regions.js` and the `bake:content` listeners in the theme, chat, component and table of contents modules. Keep an in-place update only where the component parameter bar needs it. Simplify the "last good version" of failing articles in `src/build/site.js` (`lastGood`, `articleErrorsOnly`, `shownPages`, `linkWithLastGood`) to keeping the previous output and showing the error overlay, as `src/dev/preview.js` already does for other errors.
- After the change, measure hot update with the step 0 script. If the time until the new content is visible is clearly slower than the baseline (more than 1.5 times the baseline median, or more than 200 ms slower), or the reload is visibly disruptive (flash, lost scroll position, lost component state while editing), revert to the partial update and record the numbers in this file.

### 3. Test redesign

- One test helper module: the example blog path, building a copy once per test file, serving it, launching the browser once per file, and `settle`. It replaces the inline copies (about 16 build blocks, 41 browser launches, 3 `settle` functions; `buildExample` in `test/browser/chat-page.js` is the starting point). The copy excludes `dist`, the staging folders and `node_modules`.
- Replace fixed `waitForTimeout` sleeps with waits for an observable state. Give animated interface parts an observable settled state where none exists, or use `page.clock` for timers. A fixed wait that proves something does not happen may stay.
- Review every test file for tests of implementation details and rewrite or delete them; merge tests that guard the same behavior. `test/browser/chat.test.js` and `test/browser/copy.test.js` build several blogs each; build one per file.
- `test/frames/frames.test.js` opens only the syntax article, the bento article and the homepage. Add the two long real articles, `llm-act-fns` and `matrix-calculus`: scrolling the whole article and dragging a control of one of their components, in the nightly set.
- `test/frames/frames.test.js`: the hover case passes with 15 of 20 events; find the cause instead of tolerating misses.
- `src/cli.js` imports the whole build pipeline for every command; load each command's modules with `await import()` in its branch.
- Cache the compiled theme the way `src/chat/bundle.js` caches the chat bundle, and reuse share images by the digest in their file name, so repeated test builds do not recompile or relaunch the browser.
- CI: run jobs in the Playwright container image matching the pinned version instead of installing system packages; drop `needs: performance` from the nightly `frames` job; rebalance the unit shards if they stay uneven.

### 4. Input fix

- The IME composition check exists in several versions; `src/chat/bubbles.jsx` lines 482, 875 and 975 check only `event.isComposing`, so confirming a candidate with Enter in Safari triggers the action. One shared helper used at every call site, with a test.

### 5. Design the split between core and themes

Write the design into this file under "Theme and core design" before implementing it. It must resolve:
- The shared theme layer (`src/theme`) currently carries essay-only ideas: the table of contents styles and settings, the layout variables, `.bk-toc-*` selectors, the `buttons` autohide setting. Core config validation and front matter know `toc`, while bento uses `options.js`. Bento resets essay layout in `src/themes/bento/styles/bento.css`. Each theme declares its own reader settings and options through one mechanism; core keeps only what every theme needs.
- Article styles leak into components and are held back by about 157 `:where(:not(.component-box *))` guards. One boundary (`@scope` or a shadow root in `src/components/solid-element.js`) replaces them.
- Shared block styles read container properties so bento does not undo them inside cards.
- Theme overrides: explicit extension points and a public theme interface instead of shadowing files of the shared layer by name (`src/build/theme.js`).
- Components: `params` and `layout` become static data, so the build no longer runs component modules in Node with patched browser globals (`src/components/read.js`, `src/render/math.js`). Placeholder heights are measured at build time or come from automatic height, instead of hand-tuned constants per breakpoint.
- Edge controls (chat, settings, dev overlay) share one area the theme owns, instead of informal CSS variables.
- Reduced motion: motion tokens instead of a blanket `!important` rule with exclusions.
- Lifecycle of client modules: one `start(article)` returning a dispose function.
- Layout: widths decided at build time or with container queries where possible; runtime measurement only for the table of contents.
- Copy as Markdown: slice the source using source positions on rendered nodes instead of converting rendered HTML back to Markdown.

### 6. Implement the design

Implement step 5 in commits that each keep the tests green. Delete the special cases each part replaces. Duplicates between the two themes (sidenote highlighting CSS and JS, the client entry files) and the three styles of segmented controls and switches go into the shared layer or the kit.

### 7. Remaining simplifications

- `src/build/site.js`: replace the hand-written rebuild conditions with input tracking per cached result; on a save, redo only what depends on the changed file. Start the theme build before the article loop. Write `dist` files concurrently.
- Split the `Chat` function in `src/chat/bubbles.jsx` (757 lines) by concern, and split `ArticleParser` in `src/markdown/article.js` into parsing, linking and structure modules.
- Example components: use the kit `SvgTex`, `linearScale`, `samplePath` and plot components; keep one copy of the activation functions and one colormap helper; remove the duplicated component pairs.
- Smaller items: the page walker and the `localhost` origin rewrite in scripts, the selector constants defined twice in `src/chat`, exports used only inside their own file, the private-use sentinel search in `src/markdown/table-math.js`, `pngjs` where `sharp` already decodes, the place of `src/chat/entry.js` in scroll handling (`oncePerFrame`).

### 8. Final measurements

Run the step 0 scripts on the final commit and write the comparison table of medians (dev startup, hot update, frame time per case) into the final report, together with the change in line counts between `2465439` and the final commit, broken down by area (build, markdown and rendering, theme layer, each theme, chat, components and kit, dev, scripts, unit tests, browser tests, documentation).

If the dev startup and hot update scripts gave stable numbers, move them into the repository as one script next to `scripts/measure-pages.js`, with limits in `test/perf/budgets.json` checked by `scripts/check-budgets.js` (extended for metrics that have no page and width), and run it in the nightly workflow. `scripts/measure-pages.js` measures page loading for readers and the frame time gate measures interactions; this script measures the author's `bake dev` loop, so the three share the budget file, the budget check and the screen sizes, and nothing else. Timings vary too much between runs for the pull request tier, so it stays nightly. The frame rate already runs in CI as the frame time gate.
