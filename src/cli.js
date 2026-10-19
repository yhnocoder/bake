#!/usr/bin/env node
const usage = `Usage: bake <command>

Commands:
  new <path>   Create a post folder with index.md under content/posts/
  dev          Serve the blog locally and update pages on save
  build        Generate the static site into dist/

Options:
  -h, --help   Show this help`;

const commands = new Set(['new', 'dev', 'build']);
const [command] = process.argv.slice(2);

if (command === '--help' || command === '-h') {
  console.log(usage);
} else if (commands.has(command)) {
  console.error(`bake ${command}: not implemented yet`);
  process.exitCode = 1;
} else {
  console.error(command === undefined ? usage : `Unknown command ${command}\n\n${usage}`);
  process.exitCode = 1;
}
