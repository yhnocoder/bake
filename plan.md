# Cleanup plan

The project works but has grown hard to control. This plan simplifies code, tests and documentation in ordered steps on the branch `invest/overall`. Each step is done by one subagent, ends with one or more commits on this branch and is verified before the next step starts. Nothing is pushed and no pull request is opened.

## Decisions

Kept as features: the AI chat with pets (including the 30-day "remember" of the chat key), the four table of contents styles and the reader settings, copying as Markdown, the bento theme, the frame time gate and the performance budgets, share images, theme overrides, CHANGELOG.md and the npm publishing setup. CHANGELOG.md is not changed in this cleanup.

Removed: the screenshot comparison tooling. The in-place partial update of `bake dev` stays, because the full page reload that step 2 tried was slower and blanked the components on the screen on every save.

Documentation:
- There is no developer documentation. Rules live in CLAUDE.md; knowledge the code cannot express goes into a code comment next to the code.
- README.md is documentation for people who use bake to write a blog. It describes the public interface (installation, commands, configuration, writing syntax, components, themes) and must match the code.
- TESTING.md only says how to run the tests and how the tests are designed. It does not restate constants from code.

Tests test behavior, not implementation. They cover what a user of bake or a reader of a blog can observe, and enough of it to catch regressions. A test is added only when it guards a behavior no other test guards.

## Environment

Playwright's pinned Chromium (build 1194, the one CI uses) is installed locally, so tests and measurements run with plain `chromium.launch()`. The installed Google Chrome is a fallback (`channel: 'chrome'`) if that build stops working.

Verification is sized to the change: a change to documentation only runs no tests; a change to one feature runs the unit and browser tests of that feature; a change to shared code (build, theme layer, test helpers) runs `npm test` and the full browser suite. The full browser suite also runs at the end of steps 3, 6 and 7.

The baseline measurements and their scripts are kept in `test-out/perf-baseline/` (ignored by git, read-only results). Do not delete or overwrite that folder, and keep `test-out/` in `.gitignore`. The final measurement runs `sh test-out/perf-baseline/run-all.sh <repo> test-out/perf-final`.

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
- README.md: fix it to match the code, including the chat key, which is remembered for 30 days (`src/chat/vault.js`). Add installation and the Node version. The component interface and the theme interface are documented in README.md at the end of step 6, because steps 5 and 6 change them.
- `make check` depends on `node_modules`. `make example` serves with `scripts/static-server.js`.

### 1b. Faster test runs

The unit tests are slow because every `bake build` they spawn loads the whole pipeline and launches Chromium, so speed them up before the steps that change code:
- `src/cli.js` imports the whole build pipeline for every command; load each command's modules with `await import()` in its branch.
- Cache the compiled theme the way `src/chat/bundle.js` caches the chat bundle, and reuse share images by the digest in their file name, so repeated test builds do not recompile or relaunch the browser.
- One test helper that builds a copy of the example blog once per test file (start from `buildExample` in `test/browser/chat-page.js`), used by the files that build the unchanged example blog.
Measure `npm test` before and after and record both times here.

### 2. Removals

- Delete the screenshot comparison: `scripts/screenshots.sh`, `scripts/capture-pages.js`, `scripts/compare-screenshots.js`, `scripts/screenshot-variants.js` (move the viewport sizes that other files need into one place), `test/compare-screenshots.test.js`, the Makefile target and the dependencies only it used.
- Replace the partial update of `bake dev` with a full page reload that keeps the scroll position: delete `src/dev/client/regions.js` and the `bake:content` listeners in the theme, chat, component and table of contents modules. Keep an in-place update only where the component parameter bar needs it. Simplify the "last good version" of failing articles in `src/build/site.js` (`lastGood`, `articleErrorsOnly`, `shownPages`, `linkWithLastGood`) to keeping the previous output and showing the error overlay, as `src/dev/preview.js` already does for other errors.
- After the change, measure hot update with the step 0 script. If the time until the new content is visible is clearly slower than the baseline (more than 1.5 times the baseline median, or more than 200 ms slower), or the reload is visibly disruptive (flash, lost scroll position, lost component state while editing), revert to the partial update and record the numbers in this file.
- Result: the reload was reverted and the partial update kept; the commits that replaced it are on the local branch `invest/dev-reload`. Medians of 5 runs with the step 0 script, article edit, in ms (baseline, with the reload): syntax 162, 272; llm-act-fns 319, 392; matrix-calculus 699, 754. The component and config edits reload in both versions and stayed between 1400 and 1700 ms. The syntax article took 1.68 times the baseline. Timed inside the page, the reload showed the text after 192 ms against 187 ms for the partial update, so most of the difference is the script waiting for the new page. A screencast of matrix-calculus kept the scroll position and showed no unstyled content, but the component on the screen showed its placeholder for about 500 ms after every save and lost its state. After the revert, with the simplified handling of errors in `src/build/site.js`, the article edits took 183, 327 and 679 ms.

### 3. Test redesign

Done in two parts: 3a fixes the macOS failures and the hang, completes the test helpers and replaces fixed sleeps; 3b reviews every test file for implementation details, adds the long article frame cases and changes CI.


- One test helper module: the example blog path, building a copy once per test file, serving it, launching the browser once per file, and `settle`. It replaces the inline copies (about 16 build blocks, 41 browser launches, 3 `settle` functions; `buildExample` in `test/browser/chat-page.js` is the starting point). The copy excludes `dist`, the staging folders and `node_modules`.
- Replace fixed `waitForTimeout` sleeps with waits for an observable state. Give animated interface parts an observable settled state where none exists, or use `page.clock` for timers. A fixed wait that proves something does not happen may stay.
- Review every test file for tests of implementation details and rewrite or delete them; merge tests that guard the same behavior. `test/browser/chat.test.js` and `test/browser/copy.test.js` build several blogs each; build one per file.
- `test/frames/frames.test.js` opens only the syntax article, the bento article and the homepage. Add the two long real articles, `llm-act-fns` and `matrix-calculus`: scrolling the whole article and dragging a control of one of their components, in the nightly set.
- `test/frames/frames.test.js`: the hover case passes with 15 of 20 events; find the cause instead of tolerating misses.
- CI: drop `needs: performance` from the nightly `frames` job. Running the jobs in the Playwright container image and rebalancing the shards are deferred, because nothing is pushed in this cleanup and CI cannot verify them.

- Make the suites pass on macOS, the development machine. At the start of this step, on unchanged code, 8 unit tests fail on macOS (6 of them because the temporary folder is reported as `/var/...` and resolved as `/private/var/...`; 2 `bake dev` port tests for another reason), and 26 browser tests in `copy.test.js` and `bento.test.js` fail. Find each cause; fix the code when Bake itself handles the path wrongly, and the test otherwise.
- `test/dev.test.js` "stops with a message when the blog folder can no longer be watched" sometimes hangs on macOS because it deletes the folder before the watcher has started reporting; wait for the watcher first.

### 4. Fixes found so far

- The IME composition check exists in several versions; `src/chat/bubbles.jsx` lines 482, 875 and 975 check only `event.isComposing`, so confirming a candidate with Enter in Safari triggers the action. One shared helper used at every call site, with a test.
- The `bake dev` parameter bar keeps unsaved values by component name and position, so after a component is removed from the middle of an article, the next component with the same name takes over its unsaved value. Key the values so a removed component's value is dropped, with a test that removes a component from the middle.
- `bake build` prints Node's `MODULE_TYPELESS_PACKAGE_JSON` warning when the blog's `package.json` has no `"type"`. Bake reports the problem itself in its own format, or loads the config so that Node does not warn; the output of a build contains only Bake's messages.
- The two large chat browser tests share one 120 second limit across many subtests and time out under load; split them so each file stays well under the limit.

### 5. Design the split between core and themes

Write the design into this file under "Theme and core design" before implementing it. It must resolve:
- The shared theme layer (`src/theme`) currently carries essay-only ideas: the table of contents styles and settings, the layout variables, `.bk-toc-*` selectors, the `buttons` autohide setting. Core config validation and front matter know `toc`, while bento uses `options.js`. Bento resets essay layout in `src/themes/bento/styles/bento.css`. Each theme declares its own reader settings and options through one mechanism; core keeps only what every theme needs.
- Article styles leak into components and are held back by about 157 `:where(:not(.component-box *))` guards. One boundary (`@scope` or a shadow root in `src/components/solid-element.js`) replaces them.
- Shared block styles read container properties so bento does not undo them inside cards.
- Theme overrides: explicit extension points and a public theme interface instead of shadowing files of the shared layer by name (`src/build/theme.js`).
- Components: `params` and `layout` become static data, so the build no longer runs component modules in Node with patched browser globals (`src/components/read.js`, `src/render/math.js`). Placeholder heights are measured at build time or come from automatic height, instead of hand-tuned constants per breakpoint.
- Edge controls (chat, settings, dev overlay) share one area the theme owns, instead of informal CSS variables.
- Reduced motion: motion tokens instead of a blanket `!important` rule with exclusions.
- Lifecycle of client modules: one `start(article)` returning a dispose function, used by the partial update of `bake dev` (kept after the step 2 measurement) instead of eight `bake:content` listeners.
- States a reader sees but no accessible attribute exposes (the current table of contents entry, the current homepage chip, the chosen bento card) get `aria-current` or the fitting ARIA attribute, and the tests read that instead of theme classes.
- Layout: widths decided at build time or with container queries where possible; runtime measurement only for the table of contents.
- Copy as Markdown: slice the source using source positions on rendered nodes instead of converting rendered HTML back to Markdown.

### Theme and core design

Checked against the code at commit `e8cfe85`. Each part names its choice, the reason and what is deleted.

### Ownership

- Core (`src/build`, `src/config`, `src/markdown`, `src/render`, `src/components`, `src/chat`, `src/copy`, `src/dev`) owns the article structure, including the headings with their `toc` titles and recaps, which any theme may show; the configuration fields every site has; the validation of the options a theme declares; the component declarations and runtime; the AI chat; copying as Markdown; the generated client entry with its lifecycle; and the prepaint script. The chat stays on every article page and the homepage for every theme, because it is configured in `bake.config.js` as a feature of the site.
- The shared theme layer `src/theme` stays, published as `bake/theme`, `bake/theme/client`, `bake/theme/settings` and `bake/theme/styles/*.css`. It holds the parts that both built-in themes use and a blog theme may use: the document shell with the edge areas, the header, blocks, sidenotes, the homepage, the 404 page, the settings panel, the five reading settings (color scheme, font, size, weight, spacing), the tokens including the motion tokens, the block styles, sidenote highlighting and the shared client modules. It knows nothing of a table of contents, a notes column or column widths.
- A theme owns its page layout and the values of the width variables, its options and reader settings, its client modules and the labels only it uses. The essay table of contents labels, the `.bk-toc-*` rules in `src/theme/styles/settings.css` and `print.css`, the layout variables of `src/theme/styles/page.css` and its `:root[data-script]:not([data-toc='notes'])` rule move to `src/themes/essay`.

### Options and reader settings

One mechanism: `options.js` in the theme folder exports `options` and `settings`. It stays a data module without imports, which the build imports in Node as `src/build/theme-options.js` does today.
- `options` are declared like component parameters and checked by the existing `paramProblems`. They are written in `bake.config.js` under `themes.<name>`, and in the front matter of an article that uses the theme, by their name. An option named like a core front matter field is reported in `options.js`. Essay declares `toc` (`notes`, `tabs`, `dots` or `ticks`, default `notes`); bento keeps `columns` and `rowHeight`.
- `settings` are the reader settings a theme adds to the shared reading settings: `{ values, default, control }`, where `default` is a value or `{ option: 'toc' }` and `control` is `segmented`, `switch` or `list`. Essay declares `toc` (a list whose default is the article's `toc` option) and `buttons` (a switch). Bento declares none.
- Consumers: `src/config/bake-config.js` drops the top-level `toc` field and keeps `validateThemeOptions`. `src/config/front-matter.js` reads `theme` first and accepts the options of that theme instead of `toc`. `src/build/site.js` passes `options`, the site values merged with the article values, and drops `article.toc`. `ArticleDocument` receives the declarations and writes the initial `data-<name>` attributes and the prepaint script from them, replacing the global `SETTINGS` of `src/theme/settings.js`. The theme client passes its `settings` to `startSettings(settings, { drawings })`, which builds the rows from the declarations; the drawings of the table of contents styles move to essay.
- Deleted: `TOC_STYLES` in `src/choices.js`, the `toc` and `buttons` entries of `SETTINGS` and `settingRows`, `data-default-toc`, and `toc` in the core field lists.

### Public theme interface and customization

- Files: `page.jsx` (default export, props `site`, `article`, `assets`, `options`), `client.jsx` (default export `start(document)`, which returns a dispose function), and for the site theme `home.jsx`, `not-found.jsx` and `theme.css`; `fonts.css` and `options.js` are optional.
- The built-in themes become public modules: `bake/themes/essay` exports `Page`, `Article` and `Toc`, `bake/themes/bento` exports `Page` and `Article`, and each has `/client`, `/options` and `/styles/*.css`.
- A blog customizes a built-in theme with a theme folder of another name whose files import the parts they keep from `bake/themes/essay` and replace the others, such as a `page.jsx` that renders its own header. A blog folder named `themes/essay` or `themes/bento` is an error that names this way. Reason: one explicit way, and every error is an ordinary compile error at a file of the blog.
- Deleted from `src/build/theme.js`: the lookup of a file in the blog folder, then the built-in folder, then the shared folder (`themeFolders`, `fileLocator`, `locateShared`, the resolver in `themeFileAlias` apart from the module aliases), `missingExport`, `reExportSource`, `RE_EXPORT` and `isShared`.

### CSS boundary for components

`@scope (.bk-article) to (.component-box)`, and `@scope (body) to (.component-box)` for the element rules of `page.css` such as `a`, `button` and `:focus`. Reason: `@scope` is supported by Chrome 118, Safari 17.4 and Firefox 146 (December 2025); a shadow root would need every component stylesheet and the kit CSS, which Vite loads into the document with each component chunk, adopted into each root, and selection, copying and MathJax glyphs referenced with `<use>` do not cross a shadow root. The guards sat inside `:where()`, so specificities do not change; a scoped rule now wins over an unscoped rule of equal specificity regardless of order. Rules for `.component-box` itself stay outside the scope. Deleted: the 157 `:where(:not(.component-box *))` guards (102 in `blocks.css`, 27 in `page.css`, 18 in `bento.css`, 8 in `print.css`, 2 in `notes.css`).

### Container properties for block styles

`blocks.css` reads custom properties for what a container changes: block and formula margins, the frame padding, border, radius, background and shadow, the wrapping of code lines and table cells, and the width variables `--body-width`, `--wide-width`, `--page-width` and `--page-shift`, which default to the full width. Bento sets them on `.bt-shell` and `.bt-card`, so the undo rules in `bento.css` lines 16-21 and 187-238 go. The `!important` rules in the print block of `bento.css` undo the inline `width`, `height` and `transform` that `src/themes/bento/scripts/spans.js` sets; the placement writes custom properties instead, which only `@media screen` rules read.

### Edge areas

`ArticleDocument` and the homepage render two fixed containers, `[data-edge="start"]` at the bottom left and `[data-edge="end"]` at the bottom right, which stack their children in a column. The settings button and the essay table of contents handle mount into the start area; the chat host and the `bake dev` overlay buttons mount into the end area. A theme hides an area with `data-hidden` on its container, which essay sets while it hides the buttons on scroll and while the drawer is open. The chat positions its bubbles from its host box. A theme that does not use `ArticleDocument` renders both containers itself. Deleted: `--chat-hidden`, `--chat-visibility`, `--chat-bottom`, `--chat-right` and their readers in `src/chat/entry.css`, `bubbles.css` and `src/dev/client/overlay.css`, the `@container style(--chat-visibility: hidden)` rule, the `bk-buttons-hidden` class and essay `toc.css` lines 1157-1172.

### Motion tokens

`tokens.css` defines `--motion-fast`, `--motion` and `--motion-slow` durations, `--ease`, and `--motion-distance`, a factor for translations. Under `prefers-reduced-motion: reduce` the durations become `0s` and the factor `0`, while `--fade`, the opacity fade of the settings panel, the toast and the edge areas, keeps its duration as today. Every transition and animation in the theme, chat, kit and dev CSS uses the tokens; custom properties reach the chat shadow root and the components by inheritance. Scripts keep `reducedMotion` for scrolling. Deleted: the rule in `page.css` lines 401-408, essay `toc.css` lines 1175-1189 and the reduced motion blocks of `blocks.css`, `home.css`, `settings.css`, the chat, the kit and the dev client.

### Client lifecycle

A module at `src/live.js` exports `livePage(start)`: it calls `start(document)` and, after each partial update of `bake dev`, calls the returned dispose function and `start` again. It is the only listener of the event that `src/dev/client/client.js` dispatches. The theme entry, which `src/build/theme.js` generates around the default export of `client.jsx`, the component runtime and the chat entry use it; the dev client calls the parameter bar scan directly. Every theme module becomes `startX(article)` returning a dispose function that removes its listeners, observers and created elements; modules that do not depend on the article, such as the settings panel, start once at the top level of `client.jsx`. The region names (`article`, `toc`, `source`, `glyphs`, `previews`, `words`) live in one module. Deleted: `CONTENT_EVENT` and seven listeners (`layout.js`, `preview-card.jsx`, essay `notes.js` and `toc.js`, `src/components/runtime.js`, `src/chat/bubbles.jsx`, `src/dev/client/param-bar.js`).

### Widths

A block whose natural width the build records (formulas, code in `ch`, figures and components with a pixel width) gets its width from CSS: `calc(var(--body-width) + clamp(0px, (var(--natural-width) - var(--body-width)) * 1000, var(--wide-width) - var(--body-width)))`, which is the body width when the block fits and the wide width otherwise. It applies without scripts and follows the reader's font size and font loading without measurement. Runtime measurement stays for blocks whose width only the browser knows (tables and components without a pixel width), for the table of contents and sidenote placement, which read block boxes instead of `data-resolved`, and for the bento spans and card placement, which need card heights. Deleted: the `declaredWidths` cache, `naturalWidthProbe` for declared blocks, and the font loading passes for them.

### Component declarations

The build parses each component file with Vite's `parseSync` (Oxc, part of Vite 8, which parses JSX) and evaluates the initializers of `export const params` and `export const layout` as literals: strings, numbers with a sign, booleans, `null`, arrays, objects, template strings without expressions, and names of top-level `const` declarations of the same file with such a value. Anything else is reported at its position. A default export that is a class extending `HTMLElement` is a custom element; any other default export is a Solid component. Reason over a sidecar file: a component stays one file. `llm-act-plot.jsx` inlines its `range()` helper and `presetNames`. Deleted: the Vite SSR server, `BROWSER_GLOBALS`, the `HTMLElement` stub, the `NODE_ENV` restore and the stack parsing in `src/components/read.js`, `src/components/node-math.js` with its alias, and the `asyncLoad` workaround in `src/render/math.js`.

### Component heights

Content height by default: a component without `layout.height` shows a placeholder of one theme token, `--component-placeholder-height`, until it is ready, and then takes the height of its content. `layout.height`, a number of pixels or `{ ratio }`, declares a fixed box that the component fills, as the plots and `glu-heatmap` do; the `height` Markdown attribute overrides it. Reason over build-time measurement: measuring would start Chromium on every build and in `bake dev`, and heights change with the reader's font size and the screen width. The frame gate and `componentsBlankOnScroll` check the ready state, and the runtime starts a component 1.5 screens ahead, so the height change happens below the viewport; above it, scroll anchoring keeps the visible content in place. Deleted: `narrowHeight`, `autoHeight`, height functions, `--component-narrow-*`, the `data-height="auto"` rules and `declaredHeight`.

### Copy as Markdown

`src/render/html.js` writes `data-src="start end"`, offsets into the article source, on every element made from a Markdown node with a position, block or inline. A selection boundary maps to an offset through the closest element with `data-src`: a text node covers the source between its positioned neighbours, maps character by character when its text equals that source, and otherwise moves the boundary to its nearer edge. The copied Markdown is the source between the two offsets, with the opening and closing markup of each inline element the selection cuts through, and the definitions of the footnotes it references. The HTML copy stays. `data-line` and `data-end-line` stay for `bake dev`. Deleted: `MarkdownWriter` and the selector tables of `src/copy/markdown.js`.

### Accessible states and duplicates

- The current entry of each table of contents style, of the rail and of the drawer, and the homepage chip of the group on screen get `aria-current="true"`; the drawer chapter whose card is shown gets `aria-expanded="true"`; tests read these. The bento card that scrolls after a click is a focusable scroll container, which assistive technology already reports, so it keeps `data-active` and its tests check scrolling.
- Sidenote highlighting becomes one shared module and one rule set; essay keeps the notes column and bento keeps scrolling to a clipped note. The shared layer exports one function that starts the modules both themes start (toast, folds, heading links, copy, preview card, sidenote highlighting).
- The segmented control and the switch exist in `settings.css`, `src/kit/controls.css` and `src/dev/client/switch.css`; one version in `src/kit/controls.css` serves the settings panel and the dev overlay.

### Deliberate changes

- `bake.config.js`: `toc` moves to `themes.essay.toc`. Front matter: a theme option can be set by its name, so `toc` stays valid in essay articles, becomes an error in bento articles, and bento articles can set `columns` and `rowHeight`.
- Themes: a blog folder named after a built-in theme is an error; a blog reuses a built-in theme by importing `bake/themes/essay` or `bake/themes/bento`. `client.jsx` default-exports `start`.
- Components: `params` and `layout` are literals; `narrowHeight`, `autoHeight` and height functions are removed; a component without `layout.height` takes the height of its content; an error thrown at the top level of a component module is shown by the page in the failed state and is no longer reported by `bake build`.
- Readers: formulas, code and pixel-wide blocks get their width without scripts; content below a component can move when the component loads; the current table of contents entry and homepage chip are announced by assistive technology.

### Implementation order for step 6

1. `aria-current` and `aria-expanded`: essay `toc-*.js` and `drawer.js`, `src/theme/scripts/home.js`, their CSS selectors; `test/browser/toc.test.js`, `home.test.js`, `test/frames/frames.js`.
2. Shared sidenote highlighting, the shared start function and one segmented control and switch: both themes' `notes.js`, `notes.css`, `bento.css`, `client.jsx`, `settings.css`, `src/kit/controls.css`, dev overlay; `sidenotes.test.js`, `bento.test.js`, `reader-settings.test.js`, `kit.test.js`, `dev.test.js`.
3. Motion tokens: `tokens.css` and every CSS file with a transition; `reader-settings.test.js`, `toc.test.js`, `bento.test.js`, `chat.test.js`, plus one test that the drawer handle fades and does not move under reduced motion if none exists.
4. `@scope`: `blocks.css`, `page.css`, `print.css`, essay `notes.css`, `bento.css`; `components.test.js`, `kit.test.js`, `layout.test.js`, `math.test.js`, plus one test that article paragraph and link styles do not reach an element inside a component if none exists.
5. Container properties and bento placement through custom properties: `blocks.css`, `bento.css`, `spans.js`, `print.css`; `bento.test.js`, `layout.test.js`.
6. Client lifecycle and region names: `src/live.js`, `src/build/theme.js` (generated entry), every theme script, `src/components/runtime.js`, `src/chat/bubbles.jsx` and `entry.js` (after the agent that edits `src/chat` has committed), `src/dev/client/client.js`, `param-bar.js`; `test/browser/dev.test.js`, `npm test`.
7. Edge areas: `document.jsx`, `homepage.jsx`, `settings.jsx`, essay `buttons.js`, `drawer.js` and `toc.css`, `src/chat/entry.css`, `bubbles.css`, `src/dev/client/overlay.css`; `chat.test.js`, `bento.test.js`, `toc.test.js`, `dev.test.js`, the nightly frame cases for the phone drawer and the chat panel.
8. Widths in CSS: `blocks.css`, `widths.js`, `layout.js`, essay `notes.js` and `toc.js`, bento `spans.js`; `layout.test.js`, `bento.test.js`, `sidenotes.test.js`, the frame gate.
9. Options and reader settings: `options.js` of both themes, `src/theme/settings.js`, `settings.jsx`, `document.jsx`, `src/config/bake-config.js`, `front-matter.js`, `src/build/site.js`, `theme-options.js`, `src/choices.js`, essay layout CSS moved from `page.css`, labels, `examples/blog/bake.config.js`; `config.test.js`, `front-matter.test.js`, `theme.test.js`, `reader-settings.test.js`, `toc.test.js`.
10. Theme interface: `src/build/theme.js`, `src/bundle/modules.js`, both themes' entry files; `theme.test.js`, where the shadowing tests become one test of a blog theme that imports essay and replaces its header, and `layers.test.js`.
11. Component heights: `declarations.js`, `src/render/html.js`, `blocks.css`, every component in `examples/blog/components/` and the fixtures in the tests; `components.test.js` (unit and browser), `kit.test.js`, then `npm run test:frames` with `BAKE_FRAMES=all` and `make perf` for `componentsBlankOnScroll`.
12. Static component declarations: `src/components/read.js`, `node-math.js`, `modules.js`, `src/render/math.js`, `llm-act-plot.jsx`; `components.test.js` with reported positions, `math.test.js`, `npm test`.
13. Copy as Markdown from source offsets: `src/render/html.js`, `src/theme/content.jsx`, `src/copy/`; `copy.test.js`, `chat-notes.test.js`, and `make perf` for `htmlBytes`.
14. README.md: the component interface and the theme interface, as step 6 below asks.

Risks: the cascade of scoped rules can change a rule that relied on order; Safari has not supported scroll anchoring (check the current release in part 11), so there a component above the viewport that loads can move the visible content; `data-src` on inline elements adds to `htmlBytes`, whose limit is 64000 against 51248 measured; converting the example components to content height changes how each one sizes itself.

### 6. Implement the design

Implement step 5 in commits that each keep the tests green. Delete the special cases each part replaces. Duplicates between the two themes (sidenote highlighting CSS and JS, the client entry files) and the three styles of segmented controls and switches go into the shared layer or the kit.

At the end of this step, document the component interface (exports, attributes, `bake/kit`, `bake/math`) and the theme interface (required files, props, options, overrides) in README.md for blog authors.

### 7. Remaining simplifications

- `test/dev.test.js` "prints problems as file:line:col lines" timed out once in a full `npm test` run during step 6 and passed in five later runs; find the cause.

- `src/build/site.js`: replace the hand-written rebuild conditions with input tracking per cached result; on a save, redo only what depends on the changed file. Start the theme build before the article loop. Write `dist` files concurrently.
- Split the `Chat` function in `src/chat/bubbles.jsx` (757 lines) by concern, and split `ArticleParser` in `src/markdown/article.js` into parsing, linking and structure modules.
- Example components: use the kit `SvgTex`, `linearScale`, `samplePath` and plot components; keep one copy of the activation functions and one colormap helper; remove the duplicated component pairs.
- Smaller items: the page walker and the `localhost` origin rewrite in scripts, the selector constants defined twice in `src/chat`, exports used only inside their own file, the private-use sentinel search in `src/markdown/table-math.js`, `pngjs` where `sharp` already decodes, the place of `src/chat/entry.js` in scroll handling (`oncePerFrame`).

### 8. Final measurements

Run the step 0 scripts on the final commit and write the comparison table of medians (dev startup, hot update, frame time per case) into the final report, together with the change in line counts between `2465439` and the final commit, broken down by area (build, markdown and rendering, theme layer, each theme, chat, components and kit, dev, scripts, unit tests, browser tests, documentation).

If the dev startup and hot update scripts gave stable numbers, move them into the repository as one script next to `scripts/measure-pages.js`, with limits in `test/perf/budgets.json` checked by `scripts/check-budgets.js` (extended for metrics that have no page and width), and run it in the nightly workflow. `scripts/measure-pages.js` measures page loading for readers and the frame time gate measures interactions; this script measures the author's `bake dev` loop, so the three share the budget file, the budget check and the screen sizes, and nothing else. Timings vary too much between runs for the pull request tier, so it stays nightly. The frame rate already runs in CI as the frame time gate.

## Decisions made during implementation

- Step 6 part 2: the shared sidenote highlighting marks the references and notes of both themes; the paragraph tint stays in essay, which passes it to `startArticle` as the `onSidenote` callback, and a note opened inline on a narrow screen is not a trigger, so the essay behaviour stays as before.
- Step 6 part 2: the one segmented control and switch in `src/kit/controls.css` take the look of the settings panel, so the controls inside components lose their border and their switch grows from 28 by 16 to 30 by 18 pixels; `settings.css` imports the kit file, so every page carries the kit control styles, and the kit asset test ignores the theme's own assets. The dev overlay and the parameter bars load the same file from `/__bake/controls.css` and set the switch colours through `--switch-off`, `--switch-on`, `--switch-focus` and `--switch-thumb`.
- Step 6 part 3: the durations round to the three tokens (`--motion-fast` 0.12s for up to 0.15s, `--motion` 0.2s for up to 0.25s, `--motion-slow` 0.3s above), the flash takes three times `--motion-slow`, keyword easings stay, and `--ease-out` is renamed `--ease`, also in the example components. The chat and the dev overlay sit in shadow roots that the page-wide rule never reached, so their panel, bubble and notice fades use `--fade` and keep fading with reduced motion, while their colour and scale transitions now stop like those of the page. Two media queries stay because a duration cannot express them: the pet shows a still frame, and the homepage scrolls smoothly only under `prefers-reduced-motion: no-preference`.
- Step 6 part 4: a scoped rule wins over an unscoped rule of equal specificity regardless of order, so the element rules of `page.css` in `@scope (body) to (.component-box)` wrap their selectors in `:where()`, one step less specific than before, and an equally specific rule of a later stylesheet, such as `:where(.bk-toc, .bk-toc-ui) a` for the links of the table of contents, still overrides them. For the same reason the sidenote body rules of `sidenotes.css` and the rules of `bento.css` that sit between scoped rules share the article scope, so their order against the block rules stays as before.
- Step 6 part 5: `page.css` still defines the width variables on `:root` for every theme until part 9 moves the essay layout to `src/themes/essay`, so `.bt-shell` keeps setting them to the full width; `blocks.css` falls back to the full width where no variable is set. `.bt-card` sets the code and table cell wrapping for every code block and cell in the card, so code in a list or a quote inside a card now wraps like a top-level code block; the hanging indent of wrapped lines, the card geometry of the scroll shadows and the margin of the last element in a card stay card rules in `bento.css`, because a container property does not express them.

#### Step 6 part 6: client lifecycle

- The generated theme entry around the default export of `client.jsx` belongs to part 10, because it changes the theme interface and every blog theme in the test fixtures. Until then both built-in `client.jsx` files call `livePage(start)` from `bake/live` themselves; `start(document)` has the signature that part 10 makes the default export.
- `bake/live` and `bake/regions` are public modules for themes; README documents them with the theme interface in part 14.
- `src/dev/client/client.js` dispatches `bake:update`, calls the scan of the parameter bars itself, and the chat entry asks the loaded chat to read the page again. The dispose function of the component runtime disconnects its intersection observer, so a restart observes the frames of the new content.
- A restart rebuilds the table of contents in every case. The open drawer keeps its chapter and scroll positions across the restart through a module variable of `toc.js`; a chapter card shown by pointing closes on a save, where it stayed open before when the save did not change the headings. The `refresh` methods of the card and the drawer and `outlineKey` are deleted.
- The page follows the fragment of its address once per load, so a restart does not scroll to it again.
- Checked by hand on a copy of the example blog with `bake dev` (`test-out/lifecycle/leaks.mjs`): after five saves of the syntax and activations articles at 1440 and 375 pixels, the counts of preview cards, toasts, notes layers, table of contents hosts and handles, chat hosts, settings panels, highlighted sidenotes and parameter bars and the event listeners on the window, the document and the article stay what they were after loading.

#### Step 6 part 7: edge areas

- `ArticleDocument`, the homepage and the 404 page, which shows the settings too, render both areas at the end of the body, so the keyboard still reaches the table of contents styles before the article. On narrow screens the keyboard now reaches the table of contents handle after the article, right before the settings button, where it came first before.
- A module that starts once at load appends its element (the settings, the chat), and a later one prepends (the table of contents handle, the `bake dev` bar), so the order in an area does not depend on which script runs first. The layer tokens follow the areas: `--layer-edge-start` (70, the former settings layer) and `--layer-edge-end` (75, the former chat button layer); `--layer-toc-handle`, `--layer-settings`, `--layer-chat-button` and `--layer-chat-panel` are deleted. The handle therefore sits above the preview card and the chapter card where they would meet, which only a desktop window narrower than 1000 pixels can show.
- `buttons.js` of essay owns the hidden state of both areas, from scrolling and from the open drawer, so the root classes `bk-buttons-hidden` and `bk-toc-drawer-open` are deleted. An area shows at once and hides after the fade, as the handle did, so the drawer can return the focus to the handle when it closes. The chat host and the `bake dev` host reset their styles with `all: initial`, which would make them visible inside a hidden area, so both set `visibility: inherit`.
- The button that asks about a selected passage lives in its own shadow host in the body, because it follows the selection also while essay hides the end area on phones; a new chat browser test guards this. The chat panel is placed from the host box (`right: calc(100% + gap)`, `bottom: 8px`) with the same width limit as before, written as `100vw - 100% - gap - 28px`, and its height limits read the theme's `--ui-bottom` in place of `--chat-bottom`.
- `bake dev` puts its bar (notice, dot, problems list) into the end area and its change highlights into a second host, `#bake-dev-marks`, in the body, because a highlight must scroll with the page. Visible changes in `bake dev`: the notice of a change outside the screen sits at the right edge above the dot instead of the middle of the screen; the bar hides with the chat while essay hides the buttons on phones; on pages without edge areas (an HTML file of an article folder, the page for a missing address) the bar sits in a fixed corner 16 pixels from the edges, 90 pixels lower than before, where no chat button sits under it.
- Screenshots before and after (`test-out/edges/`): the homepage, `/2026-10/syntax/` and `/2026-10/activations/` at 1440 and 375 pixels with the chat button, the open settings, the open chat panel, the buttons hidden after scrolling down and the open drawer, and `bake dev` with the dot and the problems list, are identical pixel for pixel; the only differences are the `bake dev` notice and the bar on pages without edge areas described above.
- The browser tests that read the opacity, the display or the content visibility of the handle, the settings, the chat button and the chat panel now read what the reader sees: the opacity multiplied along the ancestors, or whether the element is rendered.
- README describes the theme interface in part 14; it has to say that a page that does not use `ArticleDocument` renders `<div data-edge="start">` and `<div data-edge="end">`.

#### Step 6 part 8: widths in CSS

- The formula of the design compares lengths that the block resolves, so the build's units have to mean the same on the block as on the element they describe. A formula records `ex` of its `mjx-container`, which is `--formula-scale` (1.08) times the text size with `--formula-inset` (2px) on each side; a code block records `ch` of the code font, so the code block itself takes the code font and size, and adds `--code-inset` (18px) on each side. Both rules and the `mjx-container` and `pre.shiki` rules read the same custom properties. Figures, components and examples record pixels.
- `--natural-box`, the resolved natural width, is a registered `<length>` property, so bento reads it as pixels with `getComputedStyle` to choose the wide cards; `naturalWidthProbe`, `naturalWidths`, the `declaredWidths` cache and the `fresh` flag of the layout passes with the font family check are deleted. The page still arranges again when a font finishes loading, for the tables and the sidenotes.
- `data-resolved` remains only on blocks the page measures (tables and components without a pixel width), and an overflowing one is marked wide also where the wide width equals the body width, which looks the same. The table of contents and the sidenotes read the boxes of the blocks that reach beyond the article column.
- Visible change: without scripts, formulas, code and blocks with a pixel width take the wide width when they do not fit; a new layout test guards this. README says so.
- Checked with `test-out/widths/`: the widths and left edges of all 1344 formulas, code blocks, figures, components, examples and tables of syntax, activations, matrix-calculus and llm-act-fns at 1440, 1024 and 375 pixels, at the default and the largest text size, are the same before and after, and the 96 screenshots are identical pixel for pixel. The largest text size changes the width of 15 blocks at 1024 and 1440 pixels in the same way before and after.
