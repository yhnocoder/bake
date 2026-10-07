import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { deleteFrontmatterField, setFrontmatterField } from '../src/format/frontmatter.js';
import { format, parse } from '../src/format/index.js';

const raw = [
  '# 文章的元数据',
  'title: 旧标题 # 行尾注释',
  "eyebrow: '带引号'",
  '',
  'tags: [GELU, SiLU]',
  'authors:',
  '  - 张三',
  '  - 李四',
  'abstract: >',
  '  折叠字符串的',
  '  第二行',
  'slug: features',
].join('\n');

function lines(text) {
  return text.split('\n');
}

function valuesOf(frontmatter) {
  return parse(`---\n${frontmatter}\n---\n\n正文\n`).frontmatter;
}

function keptExcept(before, after, changed) {
  const kept = lines(before).filter((line) => !changed.includes(line));
  for (const line of kept) assert.ok(lines(after).includes(line), `line changed: ${line}`);
}

describe('setFrontmatterField', () => {
  test('修改字符串时只重写这一行，行尾注释随之删除', () => {
    const result = setFrontmatterField(raw, 'title', '新标题');
    assert.equal(result, raw.replace('title: 旧标题 # 行尾注释', 'title: 新标题'));
  });

  test('修改带引号的值', () => {
    const result = setFrontmatterField(raw, 'eyebrow', '新眉题');
    assert.equal(result, raw.replace("eyebrow: '带引号'", 'eyebrow: 新眉题'));
  });

  test('修改列表时写成块形式，缩进 2 个空格', () => {
    const result = setFrontmatterField(raw, 'authors', ['王五']);
    assert.equal(result, raw.replace('authors:\n  - 张三\n  - 李四', 'authors:\n  - 王五'));
    assert.deepEqual(valuesOf(result).authors, ['王五']);
  });

  test('修改流式列表', () => {
    const result = setFrontmatterField(raw, 'tags', ['ReLU']);
    assert.equal(result, raw.replace('tags: [GELU, SiLU]', 'tags:\n  - ReLU'));
  });

  test('修改折叠字符串', () => {
    const result = setFrontmatterField(raw, 'abstract', '一行摘要');
    assert.equal(result, raw.replace('abstract: >\n  折叠字符串的\n  第二行', 'abstract: 一行摘要'));
  });

  test('新增字段加在最后一行之后，末尾没有换行时结果也没有换行', () => {
    const result = setFrontmatterField(raw, 'date', '2026-10-07');
    assert.equal(result, `${raw}\ndate: 2026-10-07`);
    assert.equal(setFrontmatterField(`${raw}\n`, 'date', '2026-10-07'), `${raw}\ndate: 2026-10-07\n`);
  });

  test('值需要引号时加引号，解析后的值不变', () => {
    for (const value of ['1.5', 'yes', '比较: 三种激活函数', 'true']) {
      const result = setFrontmatterField(raw, 'eyebrow', value);
      assert.equal(valuesOf(result).eyebrow, value);
      keptExcept(raw, result, ["eyebrow: '带引号'"]);
    }
    assert.match(setFrontmatterField(raw, 'eyebrow', '1.5'), /^eyebrow: "1\.5"$/m);
    assert.match(setFrontmatterField(raw, 'eyebrow', '比较: 三种激活函数'), /^eyebrow: "比较: 三种激活函数"$/m);
  });

  test('其他行逐字节不变：注释、空行、流式列表、折叠字符串', () => {
    const result = setFrontmatterField(raw, 'slug', 'renamed');
    assert.equal(result, raw.replace('slug: features', 'slug: renamed'));
  });

  test('布尔值和数字', () => {
    assert.equal(setFrontmatterField('title: a\ntoc: true', 'toc', false), 'title: a\ntoc: false');
    assert.equal(setFrontmatterField('title: a', 'count', 3), 'title: a\ncount: 3');
  });
});

describe('deleteFrontmatterField', () => {
  test('删除单行字段', () => {
    assert.equal(deleteFrontmatterField(raw, 'eyebrow'), raw.replace("eyebrow: '带引号'\n", ''));
  });

  test('删除多行列表', () => {
    assert.equal(deleteFrontmatterField(raw, 'authors'), raw.replace('authors:\n  - 张三\n  - 李四\n', ''));
  });

  test('删除最后一个字段，末尾没有换行', () => {
    const result = deleteFrontmatterField(raw, 'slug');
    assert.equal(result, raw.replace('\nslug: features', ''));
    assert.equal(result.endsWith('\n'), false);
    assert.equal(deleteFrontmatterField(`${raw}\n`, 'slug'), raw.replace('slug: features', ''));
  });

  test('字段不存在时原文不变', () => {
    assert.equal(deleteFrontmatterField(raw, 'missing'), raw);
  });
});

describe('改写后的原文', () => {
  const source = (frontmatter) => `---\n${frontmatter}\n---\n\n正文\n`;

  test('parse 得到正确的值，format 不改变它', () => {
    let result = setFrontmatterField(raw, 'title', '新: 标题');
    result = setFrontmatterField(result, 'toc', false);
    result = setFrontmatterField(result, 'authors', ['甲', '乙']);
    result = deleteFrontmatterField(result, 'eyebrow');
    const values = valuesOf(result);
    assert.equal(values.title, '新: 标题');
    assert.equal(values.toc, false);
    assert.deepEqual(values.authors, ['甲', '乙']);
    assert.equal(values.eyebrow, undefined);
    assert.deepEqual(values.tags, ['GELU', 'SiLU']);
    assert.equal(format(source(result)), source(result));
  });
});
