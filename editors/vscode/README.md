# Bake for Visual Studio Code

Shows the articles of a [Bake](https://github.com/yhnocoder/bake) blog next to the editor while you write them, with the problems that Bake finds, completions and highlighting for Bake's Markdown syntax.

## Requirements

- Visual Studio Code 1.90 or later on the desktop. The preview does not work in VS Code for the web.
- Node 24 or later as the `node` command.
- A blog with Bake installed: run `npm install` in the blog root, the folder that contains `bake.config.js`.

## Features

When you open the `index.md` of an article in a blog whose npm packages are installed, the extension starts `bake dev --no-open` for that blog with the `node` command and stops it when VS Code closes. It finds Bake in `node_modules/` of the blog or of a folder above it, or uses the Bake repository itself for a blog inside it, such as `examples/blog/`. The Bake channel of the Output panel shows what `bake dev` prints, such as the address it serves. The extension then adds these features to the article:

- **Bake: Open Preview to the Side**, also a globe button at the top of the editor, shows the page of the article next to the editor as `bake dev` serves it, with its components and their parameter bars. The button also works in the editor of another Markdown extension. When you switch to the editor of another article, the preview shows that article.
- Scrolling the editor scrolls the preview to the top line of the editor, and scrolling the preview scrolls the editor in the same way. A line between the starts of two blocks lies at the same fraction of the distance between them in both. Double-clicking a block in the preview moves the editor to the line where the block starts, and the preview stays where it is. The editor of another Markdown extension offers no way to move to a line, so a double click only brings it to the front.
- While the preview is open, it shows the text of the editor as you type, a moment after you stop, without saving. The problems then refer to the unsaved text, and Write to file in a parameter bar refuses until you save. Saving the file, or closing it without saving, goes back to the file on disk.
- The problems that `bake dev` reports appear in the Problems panel and are underlined in the editor.
- Completions: after `:::` at the start of a line, the blocks of Bake, the blocks of the theme of the article and the components that the article can use; when the next line is empty, the completion also adds the closing `:::` line, and for a block with attributes it puts the cursor between braces and lists the attributes. Inside the braces of a `:::` line, the attributes and parameters that the block takes; inside the braces after an image, `width`, `height` and `float`; inside the braces after a heading, the heading attributes of the theme, such as `toc`; and after `=` the values of an enum or a boolean. After `[@` the keys of `:::references`, after `[^` the footnotes of the article, and after `\eqref{` the labels of its equations.
- A menu after `/`, as in Notion: at the start of a line it lists the blocks and components, headings, a display formula, a code block, a table, an image and a width block; after a space or a Chinese character in the text it lists a citation, a footnote, `\eqref`, an inline formula, a highlight and a link. Typing filters the menu, and Enter inserts the choice. A slash in an address or a path, such as `a/b` or `https://`, opens no menu.
- Completions and the menu work in the text editor of VS Code, not in the editor of another Markdown extension.
- Highlighting of `:::` lines and their attributes, heading attributes such as `{#act-fns toc="Activation functions"}`, paragraph anchors such as `^gelu-cost`, citations and `\eqref`.

## Install

The extension is not on the Marketplace. Build it from a clone of the Bake repository and install the file:

```bash
git clone https://github.com/yhnocoder/bake.git
cd bake/editors/vscode
npx @vscode/vsce package --out bake.vsix
code --install-extension bake.vsix
```

To update it, pull the repository, run the last two commands again and run **Developer: Reload Window** in VS Code.
