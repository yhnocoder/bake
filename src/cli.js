#!/usr/bin/env node
import { build } from './build/build.js';
import { newArticle } from './build/new-article.js';
import { configNotFoundError, hasConfig } from './config/bake-config.js';
import { DEFAULT_HOST, DEFAULT_PORT, startDevServer } from './dev/server.js';
import { errorCountLine, formatError } from './report.js';

const usage = `Usage: bake <command>

Commands:
  new <path>         Create content/posts/<path>/index.md as a draft
  dev                Serve the blog at http://localhost:4321/ and update pages on save
  build              Check the blog and generate the static site into dist/

Options:
  --port <number>    Port for bake dev; when it is in use, the next free port is used
  --host <address>   Address that bake dev listens on, 127.0.0.1 by default; 0.0.0.0 serves the local network
  -h, --help         Show this help`;

const [command, ...args] = process.argv.slice(2);

if (command === '--help' || command === '-h') {
  console.log(usage);
} else if (command === 'new') {
  runNew(args);
} else if (command === 'build') {
  await runBuild(args);
} else if (command === 'dev') {
  await runDev(args);
} else {
  fail(command === undefined ? usage : `Unknown command ${command}\n\n${usage}`);
}

function runNew(args) {
  if (args.length !== 1) return fail('Usage: bake new <path>');
  const result = newArticle(process.cwd(), args[0], localDate(new Date()));
  if (result.error) return fail(result.error);
  console.log(`Created ${result.file} (URL: ${result.url})`);
}

async function runBuild(args) {
  if (args.length > 0) return fail(`bake build: unexpected argument ${JSON.stringify(args[0])}`);
  const result = await build(process.cwd());
  if (result.errors.length > 0) {
    return fail([...result.errors.map(formatError), errorCountLine(result.errors.length)].join('\n'));
  }
  console.log(`${result.pages} ${result.pages === 1 ? 'page' : 'pages'}\ndist/ written`);
}

async function runDev(args) {
  const options = devOptions(args);
  if (options === null) return fail('Usage: bake dev [--port <number>] [--host <address>]');
  if (!hasConfig(process.cwd())) return fail(formatError(configNotFoundError()));
  let server;
  try {
    server = await startDevServer(process.cwd(), options);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
  process.once('SIGINT', () => server.close().then(() => process.exit(0)));
  server.stopped.then(fail);
}

function devOptions(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const [name, value] = [args[index], args[index + 1]];
    if ((name !== '--port' && name !== '--host') || Object.hasOwn(values, name) || value === undefined) return null;
    values[name] = value;
  }
  const port = values['--port'] ?? String(DEFAULT_PORT);
  const host = values['--host'] ?? DEFAULT_HOST;
  if (!/^\d+$/.test(port) || Number(port) > 65535 || host === '' || host.startsWith('-')) return null;
  return { port: Number(port), host };
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function localDate(date) {
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
