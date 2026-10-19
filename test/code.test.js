import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { html, parse, parsed } from './article.js';

describe('code', () => {
  test('highlights code with colors from theme variables', async () => {
    const [block] = (await parsed('```python\ndef f(x):\n    return x  # note\n```\n')).intro;
    assert.equal(block.type, 'code');
    assert.equal(
      block.html,
      [
        '<pre class="shiki bake" style="background-color:var(--code-background);color:var(--code-foreground)" tabindex="0" data-language="python"><code>',
        '<span class="line"><span style="color:var(--code-token-keyword)">def</span><span style="color:var(--code-token-function)"> f</span><span style="color:var(--code-foreground)">(</span><span style="color:var(--code-token-parameter)">x</span><span style="color:var(--code-foreground)">):</span></span>\n',
        '<span class="line"><span style="color:var(--code-token-keyword)">    return</span><span style="color:var(--code-foreground)"> x  </span><span style="color:var(--code-token-comment)"># note</span></span>',
        '</code></pre>',
      ].join(''),
    );
  });

  test('accepts language aliases and keeps code without a language as plain lines', async () => {
    assert.equal(await html('```py\nx = 1\n```\n\n```\n<b>&\n```\n'), '```py\nx = 1\n```\n```\n&#x3C;b>&#x26;\n```');
  });

  test('reports an unknown language', async () => {
    assert.deepEqual((await parse('```pyhton\nx\n```\n')).errors, ['index.md:7:1 unknown code language "pyhton"']);
  });
});
