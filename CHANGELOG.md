# Changelog

This file lists the changes of each release of Bake. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the version numbers follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `typeset(element)` in `bake/kit`, which typesets the `$…$` and `$$…$$` formulas in the text of an element, so that a component without SolidJS shows formulas the way `MathText` does.
- `/__bake/syntax` in `bake dev` also lists the fields of the front matter and the options of the article's theme, so that the VS Code extension completes them, and the file of each component, so that the extension opens it.
- In a frame of an editor, the `bake dev` page marks the block at the line that the editor sends as its cursor, and does not highlight the blocks that an update changes.
- In a frame of an editor, a click on a link to another site sends the address to the editor instead of opening the site in the frame.

### Changed

- The title of `:::aside` is set in bold at the size and colour of the text inside the box, instead of a small grey label.
- `bake new` and `bake init` load only the modules that read the configuration and write files, which shortens them from about 0.9 to 0.1 seconds.
- The `bake` command turns on Node's compile cache, which shortens each command after the first.
- `bake init` works in a folder that already holds files, such as a Git repository: it keeps the existing files, writes the missing ones and adds the missing lines to `.gitignore`.
- The workflow `.github/workflows/deploy.yml` that `bake init` writes builds the blog in the Playwright container of the Playwright version that Bake uses, instead of installing Chromium and its system libraries on every run. A blog that copied the earlier workflow can copy the new one from the README.

### Fixed

- A stylesheet without script that several components import, such as `components/lib/figure.css`, no longer makes the page request a script that the build does not write.
- On macOS, `bake dev` no longer updates every page right after it starts when a file of the blog was saved in the same millisecond as the start.

## [0.2.0]

### Added

- The `demo` workflow, which publishes the example blog to the GitHub Pages site of the repository when it is started by hand.
- Installation steps in the README.
- A check of the edge areas and the regions on each page that loads the scripts of Bake, reported at the theme file that renders the page.
- The extension for Visual Studio Code in `editors/vscode/`, with its own changelog.
- `bake dev` builds an article from the unsaved text that its page sends, lists the articles, the blocks that an article can use and the attributes of its images and headings, and lets VS Code show its pages in a frame.
- `bake init` installs the packages of the blog and Playwright's Chromium, unless given `--no-install`, writes `package.json`, `public/favicon.svg` and the workflow `.github/workflows/deploy.yml` that publishes the blog on GitHub Pages, and takes `--language`, the system language by default; the first post is written in that language.
- A globally installed `bake` runs the Bake that the blog in the current folder installs.
- `bake build --url <address>` builds the site for that address in place of `url` in `bake.config.js`.
- `bake preview` builds the blog and serves `dist/` at http://localhost:4173/.
- `bake new` takes a title, from which it makes the slug, or `--slug`, and writes `summary` and `tags` as comments in the front matter.
- The front matter field `updated`, shown in the page header and given to the sitemap.
- Images in `public/`, written as paths that start with `/`, and remote images.
- The RSS feed holds the full text of each article, every page names the favicon in `public/`, and `bake build` writes `robots.txt`.
- Links to paths of the site other than articles are checked against the pages and files of the site.

### Changed

- `home.jsx` and `not-found.jsx` are optional in a site theme, which then uses `Home` and `NotFound` of `bake/theme`.
- The npm package exports none of its files; themes and components import the `bake/` modules, which Bake resolves when it builds them.
- Bake reads `options.js` of a theme without running it, so its values are literals and constants of the same file, and it reports a value that is not one at its position.
- `url` in `bake.config.js` is optional; `bake dev` and `bake preview` use the local address without it, and `bake build` reports it missing when `--url` is not given either.
- Links that start with `/` are written relative to the page, so a site published under a path keeps them working.
- A space between the colons and the name of a block is reported at the opening line, and an unknown code language suggests the closest known one.
- `make example` serves the example blog with `bake preview`, and the `demo` workflow passes the address of the Pages site with `--url`.

## [0.1.0]

The first release of Bake as it was rebuilt to follow its new design.

### Added

- The commands `bake init`, `bake new`, `bake dev` and `bake build`.
- Articles in Markdown with front matter, GFM tables and footnotes, math typeset by MathJax 4 with the macros of `preamble.sty`, numbered equations and `\eqref`, code highlighted by Shiki, highlights, citations with a reference list, sidenotes, folds, asides, recaps, list tables, examples that show their source next to their result, images converted to WebP, and the width levels `body`, `wide` and `page`.
- Internal links between articles with preview cards, and `:::embed` blocks that show a section or a paragraph of another article.
- Plain HTML pages, published byte for byte next to the Markdown articles.
- Interactive components written as SolidJS components or custom elements, with typed parameters checked at build time, and the optional kit `bake/kit` of controls, plots and TeX labels.
- The themes `essay` and `bento`, with dark mode, reader settings for the theme and the body font, four styles of table of contents in `essay`, and blog themes that replace single files of a built-in theme.
- The homepage, grouped by category or by month, the 404 page, the RSS feed, the sitemap and one share image per article.
- Copying a selection or a whole article as Markdown.
- The AI chat with DeepSeek, which keeps the reader's API key encrypted with a passkey.
- `bake dev`, which updates the open page in place on every save, lists the problems of the blog on the page, opens a block in Visual Studio Code on a double click, and shows a parameter bar above every component that writes the chosen parameters back to the Markdown.

[Unreleased]: https://github.com/yhnocoder/bake/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/yhnocoder/bake/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/yhnocoder/bake/releases/tag/v0.1.0
