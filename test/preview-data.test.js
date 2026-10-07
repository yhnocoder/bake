import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { previewOf } from '../src/client/preview-data.js';

const use = (id) => `<svg><use href="#${id}"></use></svg>`;

const sections = {
  title: '页面标题',
  lede: { html: `<div class="lede"><p>导语 ${use('MJX-A')}</p></div>`, components: [] },
  sections: {
    intro: { kind: 'heading', html: `<h2>引言</h2><p>${use('MJX-B')}</p><demo-plot class="component"></demo-plot>`, components: ['demo-plot'] },
    def: { kind: 'block', html: `<p>定义 ${use('MJX-A')}${use('MJX-C')}</p>`, components: [] },
  },
  glyphs: { 'MJX-A': 'M1', 'MJX-B': 'M2', 'MJX-C': 'M3' },
  scripts: { 'demo-plot': '/assets/components/demo-plot.js', 'other-plot': '/assets/components/other-plot.js' },
};

describe('previewOf', () => {
  test('整篇文章：标题和导语', () => {
    assert.deepEqual(previewOf(sections, null), {
      title: '页面标题',
      html: sections.lede.html,
      components: [],
      glyphs: { 'MJX-A': 'M1' },
      scripts: {},
    });
  });

  test('没有导语的文章：html 为空字符串', () => {
    assert.deepEqual(previewOf({ ...sections, lede: null }, null), { title: '页面标题', html: '', components: [], glyphs: {}, scripts: {} });
  });

  test('标题：整节内容，只带用到的字形和组件脚本', () => {
    assert.deepEqual(previewOf(sections, 'intro'), {
      title: null,
      html: sections.sections.intro.html,
      components: ['demo-plot'],
      glyphs: { 'MJX-B': 'M2' },
      scripts: { 'demo-plot': '/assets/components/demo-plot.js' },
    });
  });

  test('段落', () => {
    assert.deepEqual(previewOf(sections, 'def'), {
      title: null,
      html: sections.sections.def.html,
      components: [],
      glyphs: { 'MJX-A': 'M1', 'MJX-C': 'M3' },
      scripts: {},
    });
  });

  test('不存在的 id 返回 null', () => {
    assert.equal(previewOf(sections, 'missing'), null);
    assert.equal(previewOf(sections, 'toString'), null);
  });
});
