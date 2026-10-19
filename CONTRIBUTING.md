# Contributing

Bake is being rebuilt from scratch to follow the redesign. This file holds the architecture rules every change must respect. When a rule can be checked by a test, the test is named next to it; new rules are added here.

## Tool and blog are separate

This repository contains only the tool: the CLI, the Markdown pipeline, the built-in themes and the optional component kit. Posts, components, custom themes and site settings live in the blog's own repository. Bake never assumes a particular blog. `examples/blog/` is the only blog in this repository: it holds the syntax article that lists every syntax item, serves as the source of the tutorial, and is the integration test fixture. Unit tests that need other blogs, such as error cases, create them in temporary directories.

## Planned layout

The layout grows task by task. Only `src/cli.js` exists today.

| Path | Contents |
|---|---|
| `src/cli.js` | Command entry: `bake new`, `bake dev`, `bake build` |
| `src/config/` | Reading `bake.config.js`, front matter and `preamble.sty` |
| `src/markdown/` | Parsing Markdown into the article structure: sections, blocks, sidenotes, table of contents |
| `src/render/` | Math, code highlighting and static HTML output |
| `src/build/` | Site generation: pages, URLs, links, homepage, RSS, share images |
| `src/dev/` | The local server for `bake dev`: rebuild on save and in-place page updates |
| `src/themes/essay/`, `src/themes/bento/` | Built-in themes: page structure in SolidJS JSX plus styles |
| `src/kit/` | Optional parts for writing components |
| `test/` | Unit and integration tests, see TESTING.md |
| `examples/blog/` | The example blog: the syntax article and the posts it links to |
| `scripts/` | Repository checks |

## Themes interpret, they never add syntax

The set of things an article can write (heading levels, blocks, width levels `body`, `wide` and `page`, front matter fields) is defined by Bake alone. A theme receives the parsed article and decides how to lay it out; it cannot add attributes, blocks or front matter fields. An attribute no theme knows is a build error. Adding syntax means changing Bake's syntax table and stating what it means in every theme.

## Error reports

Every problem Bake finds in a blog is reported as one line:

```
content/posts/llm/rope/index.md:3:7 URL /2026-10/rope/ is already used by content/posts/2026-10/rope/index.md
```

The format is `file:line:col message`, with the path relative to the blog root and the message in English. Bake runs every check before it reports, so one run lists all problems, followed by a count such as `1 error, dist/ was not written`. A build with errors writes nothing. `bake dev` shows the same lines in the terminal and on the page.

## Libraries

- Use mature libraries for general problems: Markdown parsing, math typesetting, syntax highlighting, diffing, sanitizing and validation.
- Write Bake's own core pieces by hand: the article structure, the theme interface, the component contract and the dev server's page updates.
- When switching to a library, accept its native behavior. Do not wrap it to reproduce the quirks of the code it replaces.
- Add a dependency only in the change that uses it, and pin the npm major version given in `package.json` when regenerating the lock file.

## Clean code

- The only compatibility code allowed is one migration step that upgrades old data files to the current format. There are no shims, fallbacks, legacy aliases or dual code paths.
- Fix root causes and replace old behavior outright. Code that is no longer used is deleted; git history keeps it.
- A known performance gap is written down here together with who accepted it.

## Checks guarded by tests

| Rule | Check |
|---|---|
| No comments except `why: <reason>` | `scripts/check_comment.py`, tested by `test/check-comment.test.js` |
| CLI output is English and lists the commands | `test/cli.test.js` |
| The syntax article's error appendix matches `test/fixtures/syntax-errors/` | `test/syntax-article.test.js` |
