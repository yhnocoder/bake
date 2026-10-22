const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const { completionsAt } = require('./completions.js');

const CONFIG_FILE = 'bake.config.js';
const POSTS_DIR = 'content/posts';
const BAKE_PACKAGE = '@yhnocoder/bake';
const SERVING = /^Serving the blog at (\S+)$/m;
const SOURCE_DELAY = 300;
const COMPLETION_KINDS = {
  block: vscode.CompletionItemKind.Class,
  attribute: vscode.CompletionItemKind.Property,
  value: vscode.CompletionItemKind.EnumMember,
  citation: vscode.CompletionItemKind.Reference,
  footnote: vscode.CompletionItemKind.Reference,
  equation: vscode.CompletionItemKind.Reference,
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
      const article = articleOf(document);
      if (article !== null) startBlog(article.root);
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (preview !== null && editor !== undefined && articleOf(editor.document) !== null) showArticle(editor);
    }),
    vscode.window.onDidChangeTextEditorVisibleRanges(({ textEditor, visibleRanges }) => {
      if (preview?.shown === textEditor.document.uri.fsPath && visibleRanges.length > 0) post({ bake: 'reveal', line: visibleRanges[0].start.line + 1 });
    }),
    vscode.workspace.onDidChangeTextDocument(({ document }) => sendSourceLater(document)),
    vscode.workspace.onDidCloseTextDocument((document) => sendSource(document, null)),
    vscode.languages.registerCompletionItemProvider({ language: 'markdown', scheme: 'file' }, { provideCompletionItems }, ':', '{', ' ', '=', '@', '^'),
    { dispose: () => blogs.forEach((blog) => blog.process?.kill()) },
  );
  for (const document of vscode.workspace.textDocuments) {
    const article = articleOf(document);
    if (article !== null) startBlog(article.root);
  }
}

function articleOf(document) {
  if (document.uri.scheme !== 'file' || path.basename(document.uri.fsPath) !== 'index.md') return null;
  for (let dir = path.dirname(document.uri.fsPath); dir !== path.dirname(dir); dir = path.dirname(dir)) {
    if (!existsSync(path.join(dir, CONFIG_FILE))) continue;
    const file = path.relative(dir, document.uri.fsPath).split(path.sep).join('/');
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
    const blog = { root, process: null, blocks: new Map(), url: Promise.reject(new Error(message)) };
    blog.url.catch(() => {});
    blogs.set(root, blog);
    return blog;
  }
  output.appendLine(`Starting bake dev in ${root} with ${cli}`);
  // why: node runs Bake itself, so that stopping the process stops the server; a wrapper such as npx would leave it running
  const child = spawn('node', [cli, 'dev', '--no-open'], { cwd: root });
  const blog = { root, process: child, blocks: new Map(), url: null };
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

async function followProblems(blog, url) {
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
  blog.blocks.clear();
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

function openPreview() {
  const editor = vscode.window.activeTextEditor;
  if (editor === undefined || articleOf(editor.document) === null) {
    vscode.window.showInformationMessage(`Open the index.md of an article under ${POSTS_DIR}/ in a Bake blog to preview it.`);
    return;
  }
  if (preview === null) {
    const panel = vscode.window.createWebviewPanel('bake.preview', 'Bake preview', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableScripts: true, retainContextWhenHidden: true });
    preview = { panel, shown: null, root: null, column: editor.viewColumn };
    panel.onDidDispose(() => {
      preview = null;
    });
    panel.webview.onDidReceiveMessage(answerPage);
  } else {
    preview.panel.reveal(vscode.ViewColumn.Beside, true);
  }
  showArticle(editor);
}

async function showArticle(editor) {
  const article = articleOf(editor.document);
  if (preview.shown === editor.document.uri.fsPath) return;
  preview.shown = editor.document.uri.fsPath;
  preview.root = article.root;
  preview.column = editor.viewColumn;
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
  if (preview?.panel === panel && preview.shown === editor.document.uri.fsPath) panel.webview.html = html;
}

function answerPage(message) {
  if (preview === null) return;
  if (message.bake === 'ready') {
    const editor = vscode.window.visibleTextEditors.find((candidate) => candidate.document.uri.fsPath === preview.shown);
    if (editor !== undefined && editor.visibleRanges.length > 0) post({ bake: 'reveal', line: editor.visibleRanges[0].start.line + 1 });
    for (const document of vscode.workspace.textDocuments) if (document.isDirty) sendSource(document, document.getText());
  }
  if (message.bake === 'open' && typeof message.file === 'string' && Number.isInteger(message.line)) {
    const position = new vscode.Position(message.line - 1, 0);
    vscode.window.showTextDocument(vscode.Uri.file(path.join(preview.root, message.file)), { viewColumn: preview.column, selection: new vscode.Range(position, position) });
  }
}

function post(message) {
  preview?.panel.webview.postMessage(message);
}

function sendSourceLater(document) {
  if (preview === null || articleOf(document)?.root !== preview.root) return;
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
  const article = articleOf(document);
  if (preview === null || article?.root !== preview.root) return;
  post({ bake: 'source', file: article.file, text });
}

async function provideCompletionItems(document, position) {
  const article = articleOf(document);
  if (article === null) return [];
  const blocks = await blocksOf(article).catch(() => []);
  return completionsAt(document.getText(), position.line, position.character, blocks).map((completion) => {
    const item = new vscode.CompletionItem(completion.label, COMPLETION_KINDS[completion.kind]);
    item.detail = completion.detail;
    item.documentation = completion.documentation;
    item.insertText = new vscode.SnippetString(completion.snippet);
    item.range = new vscode.Range(position.line, completion.from, position.line, position.character);
    return item;
  });
}

async function blocksOf({ root, file }) {
  const blog = startBlog(root);
  if (!blog.blocks.has(file)) {
    const url = await blog.url;
    const response = await fetch(new URL(`__bake/blocks?file=${encodeURIComponent(file)}`, url));
    blog.blocks.set(file, response.ok ? (await response.json()).blocks : []);
  }
  return blog.blocks.get(file);
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
