# Changelog

This file lists the changes of each release of Bake. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the version numbers follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The `demo` workflow, which publishes the example blog to the GitHub Pages site of the repository when it is started by hand.
- Installation steps in the README.
- A check of the edge areas and the regions on each page that loads the scripts of Bake, reported at the theme file that renders the page.

### Changed

- `home.jsx` and `not-found.jsx` are optional in a site theme, which then uses `Home` and `NotFound` of `bake/theme`.
- The npm package exports none of its files; themes and components import the `bake/` modules, which Bake resolves when it builds them.
- Bake reads `options.js` of a theme without running it, so its values are literals and constants of the same file, and it reports a value that is not one at its position.

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

[Unreleased]: https://github.com/yhnocoder/bake/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/yhnocoder/bake/releases/tag/v0.1.0
