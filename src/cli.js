#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { parseArgs } from 'node:util';
import { createDevServer } from './dev/index.js';
import { formatMessage, parseSyntax, stringify } from './format/index.js';
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

async function devCommand(options) {
  const { values } = parseArgs({ args: options, options: { port: { type: 'string', default: '4321' } } });
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`Invalid port ${values.port}`);
    return 1;
  }
  const server = await createDevServer({ root: process.cwd(), port });
  console.log(`Local: http://localhost:${server.httpServer.address().port}/`);
  return undefined;
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'format') {
  process.exitCode = await formatCommand(rest);
} else if (command === 'dev') {
  process.exitCode = await devCommand(rest);
} else {
  console.error(usage);
  process.exitCode = 1;
}
