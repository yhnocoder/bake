#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { stringify as stringifyYaml } from 'yaml';
import { build } from './build/index.js';
import { createDevServer } from './dev/index.js';
import { format, formatMessage, parseSyntax, stringify } from './format/index.js';
import { isSlug } from './format/frontmatter.js';
import { markdownFiles } from './site/pages.js';

const usage = `Usage:
  bake new <path>
  bake dev [--port 4321]
  bake build [--out dist]
  bake format [path...]`;

async function formatCommand(paths) {
  const targets = paths.length > 0 ? paths : ['content'];
  const files = [];
  for (const target of targets) {
    try {
      files.push(...(await markdownFiles(target)));
    } catch {
      console.error(`Cannot find ${target}`);
      return 1;
    }
  }
  let rewritten = 0;
  let failed = false;
  for (const file of files) {
    const path = relative(process.cwd(), file) || file;
    const source = await readFile(file, 'utf8');
    const { tree, messages } = parseSyntax(source, { path });
    if (messages.length > 0) {
      for (const message of messages) console.error(formatMessage(message));
      failed = true;
      continue;
    }
    const output = stringify(tree);
    if (output === source) continue;
    await writeFile(file, output);
    console.log(path);
    rewritten++;
  }
  const summary = rewritten === 0 ? 'No files to rewrite' : `Rewrote ${rewritten} ${rewritten === 1 ? 'file' : 'files'}`;
  console.log(summary);
  return failed ? 1 : 0;
}

async function newCommand(path) {
  if (path === '/' || !isSlug(path)) {
    console.error(`Invalid path ${path}: use segments of lowercase letters, digits and - separated by /`);
    return 1;
  }
  const file = `content/${path}.md`;
  const source = format(`---\n${stringifyYaml({ title: path.split('/').at(-1), slug: path })}---\n`);
  await mkdir(dirname(file), { recursive: true });
  try {
    await writeFile(file, source, { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    console.error(`${file} already exists`);
    return 1;
  }
  console.log(`Created ${file}`);
  return 0;
}

async function buildCommand(out) {
  const shown = `${out.replace(/\/+$/, '')}/`;
  const { errors, pageCount } = await build(process.cwd(), { out });
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    console.error(`${errors.length} ${errors.length === 1 ? 'error' : 'errors'}, ${shown} was not written`);
    return 1;
  }
  console.log(`Built ${pageCount} ${pageCount === 1 ? 'page' : 'pages'} to ${shown}`);
  return 0;
}

async function devCommand(options) {
  const { values } = parseArgs({ args: options, options: { port: { type: 'string', default: '4321' } } });
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`Invalid port ${values.port}`);
    return 1;
  }
  let server;
  try {
    server = await createDevServer({ root: process.cwd(), port });
  } catch (error) {
    if (!error.messages) throw error;
    for (const message of error.messages) console.error(formatMessage(message));
    console.error(`${error.messages.length} ${error.messages.length === 1 ? 'error' : 'errors'}, the dev server was not started`);
    return 1;
  }
  console.log(`Local: http://localhost:${server.httpServer.address().port}/`);
  return undefined;
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'format') {
  process.exitCode = await formatCommand(rest);
} else if (command === 'new' && rest.length === 1) {
  process.exitCode = await newCommand(rest[0]);
} else if (command === 'build' && (rest.length === 0 || (rest.length === 2 && rest[0] === '--out'))) {
  process.exitCode = await buildCommand(rest[1] ?? 'dist');
} else if (command === 'dev') {
  process.exitCode = await devCommand(rest);
} else {
  console.error(usage);
  process.exitCode = 1;
}
