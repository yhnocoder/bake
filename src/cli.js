#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire, enableCompileCache } from 'node:module';
import { dirname, join } from 'node:path';

// why: each command imports its modules after this line, and the cache of their compiled code saves most of the start time of a command after the first
enableCompileCache();

const usage = `Usage: bake <command>

Commands:
  init [folder]      Create a blog in folder, the current folder by default, install its packages and Chromium,
                     and write the workflow that publishes it on GitHub Pages
  new <title|path>   Create a draft from a title, such as "Rope data structures", or at content/posts/<path>/
  dev                Serve the blog at http://localhost:4321/, open it in the browser and update pages on save
  build              Check the blog and generate the static site into dist/
  preview            Build the blog for this computer and serve dist/ at http://localhost:4173/

Options:
  --language <code>  Language of the blog that bake init creates, such as en or zh-CN; the system language by default
  --no-install       bake init writes the files only and installs nothing
  --slug <slug>      Slug of the draft that bake new creates from a title
  --url <address>    Address of the published site for bake build, in place of url in bake.config.js
  --port <number>    Port for bake dev and bake preview; when it is in use, the next free port is used
  --host <address>   Address that bake dev listens on, 127.0.0.1 by default; 0.0.0.0 serves the local network
  --no-open          Do not open the browser when bake dev or bake preview starts
  -h, --help         Show this help

Open bake dev at localhost rather than 127.0.0.1: the AI chat stores its key with a passkey,
and browsers do not create passkeys for an IP address.`;

const [command, ...args] = process.argv.slice(2);
const local = command === 'init' ? null : localCli(process.cwd());

if (local !== null) {
  delegate(local);
} else if (command === '--help' || command === '-h') {
  console.log(usage);
} else if (command === 'init') {
  await runInit(args);
} else if (command === 'new') {
  await runNew(args);
} else if (command === 'build') {
  await runBuild(args);
} else if (command === 'dev') {
  await runDev(args);
} else if (command === 'preview') {
  await runPreview(args);
} else {
  fail(command === undefined ? usage : `Unknown command ${command}\n\n${usage}`);
}

// A bake installed globally hands a command in a blog to the Bake that the blog installs, so that every computer builds the blog with the version its package.json names.
function localCli(folder) {
  let file;
  try {
    file = createRequire(join(folder, 'package.json')).resolve('@yhnocoder/bake/package.json');
  } catch {
    return null;
  }
  const cli = join(dirname(file), JSON.parse(readFileSync(file, 'utf8')).bin.bake);
  return realpathSync(cli) === realpathSync(import.meta.filename) ? null : cli;
}

function delegate(cli) {
  const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], { stdio: 'inherit' });
  // why: Ctrl+C reaches both processes, and the Bake of the blog decides when it has stopped
  process.on('SIGINT', () => {});
  child.on('exit', (code, signal) => {
    process.exitCode = code ?? (signal === null ? 1 : 128);
  });
}

async function runInit(args) {
  const options = parseOptions(args, { '--language': 'value', '--no-install': 'flag' });
  if (options === null || options.positional.length > 1) return fail('Usage: bake init [folder] [--language <code>] [--no-install]');
  const { installDependencies, newBlog, systemLanguage } = await import('./build/new-blog.js');
  const folder = options.positional[0] ?? '.';
  const result = newBlog(folder, { date: localDate(new Date()), language: options['--language'] ?? systemLanguage() });
  if (result.error) return fail(result.error);
  const kept = result.kept.length === 0 ? [] : ['Kept the existing files:', ...result.kept.map((file) => `  ${file}`)];
  console.log([`Created a blog in ${result.root}:`, ...result.written.map((file) => `  ${file}`), ...kept].join('\n'));
  const install = !options['--no-install'];
  if (install) {
    const error = installDependencies(result.root);
    if (error) return fail(error);
  }
  const next = [...(folder === '.' ? [] : [`cd ${shellWord(folder)}`]), ...(install ? [] : ['npm install']), 'npm run dev'].join(' && ');
  console.log(
    [
      `${result.url === null ? '' : `The first post is at ${result.url}. `}Next: ${next}`,
      'To publish the blog on GitHub Pages, push it to a GitHub repository and choose GitHub Actions as the source under Settings > Pages;',
      '.github/workflows/deploy.yml then publishes every push to main.',
    ].join('\n'),
  );
}

function shellWord(text) {
  return /^[\w./-]+$/.test(text) ? text : `'${text.replaceAll("'", "'\\''")}'`;
}

async function runNew(args) {
  const options = parseOptions(args, { '--slug': 'value' });
  if (options === null || options.positional.length !== 1) return fail('Usage: bake new <title|path> [--slug <slug>]');
  const { newArticle } = await import('./build/new-article.js');
  const result = newArticle(process.cwd(), options.positional[0], { date: localDate(new Date()), slug: options['--slug'] });
  if (result.error) return fail(result.error);
  console.log(`Created ${result.file} (URL: ${result.url})`);
}

async function runBuild(args) {
  const options = parseOptions(args, { '--url': 'value' });
  if (options === null || options.positional.length > 0) return fail('Usage: bake build [--url <address>]');
  const { urlProblem } = await import('./config/bake-config.js');
  const url = options['--url'];
  const problem = url === undefined ? null : urlProblem(url);
  if (problem) return fail(`bake build: --url ${problem.replace(/^url /, '')}`);
  await buildSite({ url });
}

async function buildSite(addresses) {
  const { build } = await import('./build/build.js');
  const { errorCountLine, formatError } = await import('./shared/report.js');
  const result = await build(process.cwd(), addresses);
  if (result.errors.length > 0) {
    fail([...result.errors.map(formatError), errorCountLine(result.errors.length)].join('\n'));
    return false;
  }
  console.log(`${result.pages} ${result.pages === 1 ? 'page' : 'pages'}\ndist/ written`);
  return true;
}

async function runPreview(args) {
  const options = parseOptions(args, { '--port': 'value', '--no-open': 'flag' });
  const port = options?.['--port'] ?? '4173';
  if (options === null || options.positional.length > 0 || !/^\d+$/.test(port) || Number(port) > 65535) return fail('Usage: bake preview [--port <number>] [--no-open]');
  const { configNotFoundError, hasConfig } = await import('./config/bake-config.js');
  const { formatError } = await import('./shared/report.js');
  if (!hasConfig(process.cwd())) return fail(formatError(configNotFoundError()));
  const { serveStatic } = await import('./dev/static-server.js');
  const { openInBrowser } = await import('./dev/open.js');
  const { DIST_DIR } = await import('./build/dist.js');
  const server = await serveStatic(join(process.cwd(), DIST_DIR), { port: Number(port), localhost: true });
  if (!(await buildSite({ localUrl: `${server.origin}/` }))) return server.close();
  console.log(`Serving dist/ at ${server.origin}/`);
  if (!options['--no-open'] && process.stdout.isTTY) openInBrowser(`${server.origin}/`);
  process.once('SIGINT', () => server.close().then(() => process.exit(0)));
}

// Returns the options and the positional arguments, or null for an unknown, repeated or incomplete option.
function parseOptions(args, known) {
  const options = { positional: [] };
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (!name.startsWith('-')) {
      options.positional.push(name);
      continue;
    }
    if (!Object.hasOwn(known, name) || Object.hasOwn(options, name)) return null;
    if (known[name] === 'flag') {
      options[name] = true;
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value === '' || value.startsWith('-')) return null;
    options[name] = value;
    index += 1;
  }
  return options;
}

async function runDev(args) {
  const options = devOptions(args);
  if (options === null) return fail('Usage: bake dev [--port <number>] [--host <address>] [--no-open]');
  const { configNotFoundError, hasConfig } = await import('./config/bake-config.js');
  const { formatError } = await import('./shared/report.js');
  if (!hasConfig(process.cwd())) return fail(formatError(configNotFoundError()));
  const { startDevServer } = await import('./dev/server.js');
  const { openInBrowser } = await import('./dev/open.js');
  let server;
  try {
    server = await startDevServer(process.cwd(), options);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
  if (options.open && process.stdout.isTTY) openInBrowser(server.url);
  process.once('SIGINT', () => server.close().then(() => process.exit(0)));
  server.stopped.then(fail);
}

function devOptions(args) {
  const options = parseOptions(args, { '--port': 'value', '--host': 'value', '--no-open': 'flag' });
  if (options === null || options.positional.length > 0) return null;
  const port = options['--port'];
  if (port !== undefined && (!/^\d+$/.test(port) || Number(port) > 65535)) return null;
  return { port: port === undefined ? undefined : Number(port), host: options['--host'], open: options['--no-open'] !== true };
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function localDate(date) {
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
