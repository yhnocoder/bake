const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const { blockNameAt, completionsAt } = require('./completions.js');

const CONFIG_FILE = 'bake.config.js';
const POSTS_DIR = 'content/posts';
const BAKE_PACKAGE = '@yhnocoder/bake';
const SERVING = /^Serving the blog at (\S+)$/m;
const SOURCE_DELAY = 300;
const NO_SYNTAX = { blocks: [], image: {}, headings: {}, frontMatter: {} };
// why: revealing a line scrolls the editor in several steps, and each step would scroll the preview back to the start of a block
const FOLLOW_QUIET_TIME = 300;
const COMPLETION_KINDS = {
  block: vscode.CompletionItemKind.Class,
  attribute: vscode.CompletionItemKind.Property,
  value: vscode.CompletionItemKind.EnumMember,
  citation: vscode.CompletionItemKind.Reference,
  footnote: vscode.CompletionItemKind.Reference,
  equation: vscode.CompletionItemKind.Reference,
  snippet: vscode.CompletionItemKind.Snippet,
};

const blogs = new Map();
const sourceTimers = new Map();
let output;
let diagnostics;
let preview = null;

function activate(context) {
  output = vscode.window.createOutputChannel('Bake');
  diagnostics = vscode.languages.createDiagnosticCollection('bake');
  context.subscriptions.push(
    output,
    diagnostics,
    vscode.commands.registerCommand('bake.openPreview', openPreview),
    vscode.workspace.onDidOpenTextDocument((document) => {
      const article = articleOf(document.uri);
      if (article !== null) startBlog(article.root);
    }),
    vscode.window.tabGroups.onDidChangeTabs(followActiveTab),
    vscode.window.tabGroups.onDidChangeTabGroups(followActiveTab),
    vscode.window.onDidChangeTextEditorVisibleRanges(({ textEditor, visibleRanges }) => {
      if (preview?.shown !== textEditor.document.uri.fsPath || visibleRanges.length === 0 || Date.now() < preview.quietUntil) return;
      post({ bake: 'reveal', line: visibleRanges[0].start.line + 1 });
    }),
    vscode.window.onDidChangeTextEditorSelection(({ textEditor }) => postCursor(textEditor)),
    vscode.workspace.onDidChangeTextDocument(({ document }) => sendSourceLater(document)),
    vscode.workspace.onDidCloseTextDocument((document) => sendSource(document, null)),
    vscode.languages.registerCompletionItemProvider({ language: 'markdown', scheme: 'file' }, { provideCompletionItems }, ':', '{', ' ', '=', '@', '^', '/'),
    vscode.languages.registerDefinitionProvider({ language: 'markdown', scheme: 'file' }, { provideDefinition }),
    { dispose: () => blogs.forEach((blog) => blog.process?.kill()) },
  );
  for (const document of vscode.workspace.textDocuments) {
    const article = articleOf(document.uri);
    if (article !== null) startBlog(article.root);
  }
}

function articleOf(uri) {
  if (uri?.scheme !== 'file' || path.basename(uri.fsPath) !== 'index.md') return null;
  for (let dir = path.dirname(uri.fsPath); dir !== path.dirname(dir); dir = path.dirname(dir)) {
    if (!existsSync(path.join(dir, CONFIG_FILE))) continue;
    const file = path.relative(dir, uri.fsPath).split(path.sep).join('/');
    return file.startsWith(`${POSTS_DIR}/`) ? { root: dir, file } : null;
  }
  return null;
}

// Finds Bake as Node finds a package, in node_modules/ of the blog or of a folder above it, or the Bake repository itself for a blog inside it, such as examples/blog/.
function bakeCli(root) {
  for (let dir = root; dir !== path.dirname(dir); dir = path.dirname(dir)) {
    const installed = path.join(dir, 'node_modules', ...BAKE_PACKAGE.split('/'));
    if (existsSync(path.join(installed, 'src', 'cli.js'))) return path.join(installed, 'src', 'cli.js');
    if (packageName(dir) === BAKE_PACKAGE) return path.join(dir, 'src', 'cli.js');
  }
  return null;
}

function packageName(dir) {
  try {
    return JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).name;
  } catch {
    return undefined;
  }
}

function startBlog(root) {
  if (blogs.has(root)) return blogs.get(root);
  const cli = bakeCli(root);
  if (cli === null) {
    const message = `Bake is not installed for the blog in ${root}; run npm install there and reload the window`;
    output.appendLine(message);
    vscode.window.showErrorMessage(message);
    const blog = { root, process: null, syntax: new Map(), url: Promise.reject(new Error(message)) };
    blog.url.catch(() => {});
    blogs.set(root, blog);
    return blog;
  }
  output.appendLine(`Starting bake dev in ${root} with ${cli}`);
  // why: node runs Bake itself, so that stopping the process stops the server; a wrapper such as npx would leave it running
  const child = spawn('node', [cli, 'dev', '--no-open'], { cwd: root });
  const blog = { root, process: child, syntax: new Map(), url: null };
  blogs.set(root, blog);
  blog.url = new Promise((done, fail) => {
    let printed = '';
    const read = (chunk) => {
      const text = chunk.toString();
      output.append(text);
      if (printed === null) return;
      printed += text;
      const serving = SERVING.exec(printed);
      if (serving === null) return;
      printed = null;
      done(serving[1]);
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.on('error', (error) => fail(new Error(`bake dev cannot start in ${root}: ${error.message}`)));
    child.on('exit', (code) => {
      blogs.delete(root);
      clearDiagnostics(root);
      fail(new Error(`bake dev stopped in ${root} with exit code ${code}; the Bake output shows why`));
    });
  });
  blog.url
    .then((url) => followProblems(blog, url))
    .catch((error) => {
      output.appendLine(error.message);
      vscode.window.showErrorMessage(error.message);
    });
  return blog;
}

// why: fetch ends a response that sends nothing for five minutes, and the event stream of bake dev is quiet while nothing changes
async function followProblems(blog, url) {
  while (blogs.get(blog.root) === blog) {
    try {
      await readProblems(blog, url);
    } catch (error) {
      if (blogs.get(blog.root) === blog) output.appendLine(`The connection to bake dev ended (${error.message}); connecting again`);
    }
    await new Promise((done) => setTimeout(done, 1000));
  }
}

async function readProblems(blog, url) {
  const response = await fetch(new URL('__bake/events', url));
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let end;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const message = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const event = /^event: (.*)$/m.exec(message)?.[1];
      const data = /^data: (.*)$/m.exec(message)?.[1];
      if (event === 'problems') showProblems(blog, JSON.parse(data));
    }
  }
}

function showProblems(blog, problems) {
  blog.syntax.clear();
  clearDiagnostics(blog.root);
  const byFile = new Map();
  for (const problem of problems) {
    const [line, column] = problem.location.split(':').map(Number);
    const start = new vscode.Position(line - 1, column - 1);
    const diagnostic = new vscode.Diagnostic(new vscode.Range(start, start.translate(0, 1)), problem.message, vscode.DiagnosticSeverity.Error);
    diagnostic.source = 'bake';
    const uri = vscode.Uri.file(path.join(blog.root, problem.file));
    byFile.set(uri.toString(), [...(byFile.get(uri.toString()) ?? []), diagnostic]);
  }
  for (const [uri, list] of byFile) diagnostics.set(vscode.Uri.parse(uri), list);
}

function clearDiagnostics(root) {
  const uris = [];
  diagnostics.forEach((uri) => uris.push(uri));
  for (const uri of uris) if (uri.fsPath.startsWith(`${root}${path.sep}`)) diagnostics.delete(uri);
}

// The button at the top of an editor passes the file of the editor, also for an editor that is not a text editor, such as a Markdown editor of another extension.
function openPreview(uri = activeTab()?.input?.uri) {
  if (articleOf(uri) === null) {
    vscode.window.showInformationMessage(`Open the index.md of an article under ${POSTS_DIR}/ in a Bake blog to preview it.`);
    return;
  }
  if (preview === null) {
    const panel = vscode.window.createWebviewPanel('bake.preview', 'Bake preview', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableScripts: true, retainContextWhenHidden: true });
    preview = { panel, shown: null, root: null, column: null, quietUntil: 0 };
    panel.onDidDispose(() => {
      preview = null;
    });
    panel.webview.onDidReceiveMessage(answerPage);
  } else {
    preview.panel.reveal(vscode.ViewColumn.Beside, true);
  }
  showArticle(uri, vscode.window.tabGroups.activeTabGroup.viewColumn);
}

function activeTab() {
  return vscode.window.tabGroups.activeTabGroup.activeTab;
}

function followActiveTab() {
  const uri = activeTab()?.input?.uri;
  if (preview !== null && articleOf(uri) !== null) showArticle(uri, vscode.window.tabGroups.activeTabGroup.viewColumn);
}

async function showArticle(uri, column) {
  const article = articleOf(uri);
  preview.column = column;
  if (preview.shown === uri.fsPath) return;
  preview.shown = uri.fsPath;
  preview.root = article.root;
  const { panel } = preview;
  let html;
  try {
    const url = await startBlog(article.root).url;
    const { articles } = await (await fetch(new URL('__bake/articles', url))).json();
    const found = articles.find((candidate) => candidate.file === article.file);
    if (found?.url == null) {
      html = messagePage(`bake dev shows no page for ${article.file}; the Problems panel lists what keeps it from being built.`);
    } else {
      const external = await vscode.env.asExternalUri(vscode.Uri.parse(new URL(found.url, url).href));
      panel.title = `Bake: ${found.title ?? article.file}`;
      html = framePage(external.toString(true));
    }
  } catch (error) {
    html = messagePage(error.message);
  }
  if (preview?.panel === panel && preview.shown === uri.fsPath) panel.webview.html = html;
}

function postCursor(editor) {
  if (preview?.shown === editor.document.uri.fsPath) post({ bake: 'cursor', line: editor.selection.active.line + 1 });
}

function answerPage(message) {
  if (preview === null) return;
  const editor = vscode.window.visibleTextEditors.find((candidate) => candidate.document.uri.fsPath === preview.shown);
  if (message.bake === 'ready') {
    if (editor !== undefined && editor.visibleRanges.length > 0) post({ bake: 'reveal', line: editor.visibleRanges[0].start.line + 1 });
    if (editor !== undefined) postCursor(editor);
    for (const document of vscode.workspace.textDocuments) if (document.isDirty) sendSource(document, document.getText());
  }
  if (message.bake === 'link' && typeof message.url === 'string' && /^(https?|mailto):/.test(message.url)) vscode.env.openExternal(vscode.Uri.parse(message.url, true));
  if (message.bake === 'scroll' && editor !== undefined && Number.isInteger(message.line)) {
    preview.quietUntil = Date.now() + FOLLOW_QUIET_TIME;
    const position = new vscode.Position(message.line - 1, 0);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.AtTop);
  }
  if (message.bake === 'open' && typeof message.file === 'string' && Number.isInteger(message.line)) {
    const position = new vscode.Position(message.line - 1, 0);
    const uri = vscode.Uri.file(path.join(preview.root, message.file));
    const custom = vscode.window.tabGroups.all.flatMap((group) => group.tabs.map((tab) => ({ group, input: tab.input }))).find(({ input }) => input instanceof vscode.TabInputCustom && input.uri.fsPath === uri.fsPath);
    // why: the editor of another Markdown extension offers no way to move to a line, so it is only brought to the front instead of opening a text editor next to it
    if (custom !== undefined) return vscode.commands.executeCommand('vscode.openWith', uri, custom.input.viewType, custom.group.viewColumn);
    const opened = preview;
    // why: the editor scrolls to the double-clicked block, and the preview, which already shows it, stays where the reader left it
    opened.quietUntil = Infinity;
    vscode.window
      .showTextDocument(uri, { viewColumn: opened.column, selection: new vscode.Range(position, position) })
      .then(
        () => (opened.quietUntil = Date.now() + FOLLOW_QUIET_TIME),
        () => (opened.quietUntil = 0),
      );
  }
}

function post(message) {
  preview?.panel.webview.postMessage(message);
}

function sendSourceLater(document) {
  if (preview === null || articleOf(document.uri)?.root !== preview.root) return;
  const key = document.uri.toString();
  clearTimeout(sourceTimers.get(key));
  sourceTimers.set(
    key,
    setTimeout(() => {
      sourceTimers.delete(key);
      sendSource(document, document.isDirty ? document.getText() : null);
    }, SOURCE_DELAY),
  );
}

function sendSource(document, text) {
  const article = articleOf(document.uri);
  if (preview === null || article?.root !== preview.root) return;
  post({ bake: 'source', file: article.file, text });
}

async function provideCompletionItems(document, position) {
  const article = articleOf(document.uri);
  if (article === null) return [];
  const syntax = await syntaxOf(article).catch(() => NO_SYNTAX);
  return completionsAt(document.getText(), position.line, position.character, syntax).map((completion, index) => {
    const item = new vscode.CompletionItem(completion.label, COMPLETION_KINDS[completion.kind]);
    item.detail = completion.detail;
    item.documentation = completion.documentation;
    item.insertText = new vscode.SnippetString(completion.snippet);
    item.range = new vscode.Range(position.line, completion.from, position.line, position.character);
    item.sortText = String(index).padStart(4, '0');
    if (completion.filter !== undefined) item.filterText = completion.filter;
    if (completion.suggest) item.command = { command: 'editor.action.triggerSuggest', title: 'List the completions' };
    return item;
  });
}

async function provideDefinition(document, position) {
  const article = articleOf(document.uri);
  const block = article === null ? null : blockNameAt(document.getText(), position.line, position.character);
  if (block === null) return null;
  const syntax = await syntaxOf(article).catch(() => NO_SYNTAX);
  const component = syntax.blocks.find((candidate) => candidate.name === block.name && candidate.kind === 'component');
  if (component === undefined) return null;
  const start = new vscode.Range(0, 0, 0, 0);
  return [{ originSelectionRange: new vscode.Range(position.line, block.from, position.line, block.to), targetUri: vscode.Uri.file(path.join(article.root, component.file)), targetRange: start, targetSelectionRange: start }];
}

async function syntaxOf({ root, file }) {
  const blog = startBlog(root);
  if (!blog.syntax.has(file)) {
    const url = await blog.url;
    const response = await fetch(new URL(`__bake/syntax?file=${encodeURIComponent(file)}`, url));
    blog.syntax.set(file, response.ok ? await response.json() : NO_SYNTAX);
  }
  return blog.syntax.get(file);
}

function framePage(src) {
  const origin = new URL(src).origin;
  const nonce = randomBytes(16).toString('base64');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${origin}; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
<style>html, body, iframe { margin: 0; padding: 0; border: 0; width: 100%; height: 100%; overflow: hidden; }</style>
</head>
<body>
<iframe src="${escapeHtml(src)}"></iframe>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const frame = document.querySelector('iframe');
addEventListener('message', (event) => {
  if (event.source === frame.contentWindow) vscode.postMessage(event.data);
  else frame.contentWindow.postMessage(event.data, ${JSON.stringify(origin)});
});
</script>
</body>
</html>`;
}

function messagePage(text) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'"></head><body><p>${escapeHtml(text)}</p></body></html>`;
}

function escapeHtml(text) {
  return text.replace(/[&<>"]/g, (character) => `&#${character.charCodeAt(0)};`);
}

module.exports = { activate };
