import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { formatMessage } from '../../src/format/index.js';
import { render } from '../../src/render/index.js';

const [blogDirectory, articlePath, outputPath] = process.argv.slice(2);
const blog = resolve(blogDirectory);
const { default: config } = await import(join(blog, 'bake.config.js'));
globalThis.HTMLElement ??= class {};
const { default: DemoPlot } = await import(join(blog, 'components/demo-plot.js'));
const source = readFileSync(join(blog, articlePath), 'utf8');
const result = await render(source, { path: articlePath, config, components: { 'demo-plot': DemoPlot.properties } });
for (const message of result.messages) console.log(formatMessage(message));
if (outputPath) {
  const style = `body { max-width: 46rem; margin: 2rem auto; padding: 0 1rem; font-family: sans-serif; line-height: 1.7; }
.sidenote, .sidenote.unnumbered { display: block; margin: 0.5rem 0 0.5rem 2rem; padding-left: 0.6rem; border-left: 2px solid #ccc; font-size: 0.85em; }
.math.display { margin: 1rem 0; overflow-x: auto; }
.wide, .callout, .lede, .bento, demo-plot { display: block; border: 1px dashed #bbb; padding: 0.5rem; margin: 0.8rem 0; }
.bento { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.5rem; }
.card { border: 1px solid #ccc; padding: 0.4rem; }
.float-left { float: left; margin: 0 1.5em 0.5rem 0; }
.float-right { float: right; margin: 0 0 0.5rem 1.5em; }
figure img { max-width: 100%; }
h2, h3 { clear: both; }`;
  const page = `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>${result.page.title}</title><style>${style}</style></head>
<body>${result.mathDefs}
<article>${result.html}</article>
</body>
</html>
`;
  const directory = resolve(outputPath, '..');
  cpSync(join(blog, 'content/assets'), join(directory, 'assets'), { recursive: true });
  writeFileSync(outputPath, page);
}
process.exitCode = result.messages.length > 0 ? 1 : 0;
