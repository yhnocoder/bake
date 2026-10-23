# Changelog

This file lists the changes of each version of the Bake extension for Visual Studio Code. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the version numbers follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Completions in the front matter: the fields that are not written yet, the options of the article's theme, such as `toc`, and the values of a field with choices. `date` and `updated` start with the date of today.

## [0.1.0]

The first version. It needs a version of Bake that serves `/__bake/source`, `/__bake/articles` and `/__bake/syntax` in `bake dev`.

### Added

- **Bake: Open Preview to the Side**, which shows the page of an article next to the editor as `bake dev` serves it, also from the editor of another Markdown extension.
- Scrolling of the preview and the editor together, and a double click in the preview that moves the editor to the block.
- The unsaved text of the editor in the preview, and the problems of `bake dev` in the Problems panel.
- Completions for blocks, attributes of blocks, images and headings, parameter values, citations, footnotes and equation labels.
- A menu of blocks and Markdown snippets after `/`.
- Highlighting for `:::` lines, heading attributes, paragraph anchors, citations and `\eqref`.
