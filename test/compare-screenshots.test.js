import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { PNG } from 'pngjs';
import {
  addToGroups,
  changedArea,
  compareShot,
  crop,
  cropArea,
  describe as describeChange,
  maxImageWidth,
  maxPanelWidth,
  pad,
  parseShot,
  sheetColumns,
  sheetGap,
  sheetPadding,
  slices,
  summary,
} from '../scripts/compare-screenshots.js';

function image(width, height, color = [255, 255, 255, 255]) {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) png.data.set(color, i);
  return png;
}

function paint(png, { left, top, right, bottom }, color = [0, 0, 0, 255]) {
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) png.data.set(color, (y * png.width + x) * 4);
  }
  return png;
}

function sheetWidth(widths) {
  const columns = sheetColumns(widths);
  return columns * Math.max(...widths) + (columns - 1) * sheetGap + 2 * sheetPadding;
}

describe('screenshot comparison', () => {
  test('finds the rows and columns of the changed pixels', () => {
    const diff = paint(image(100, 50), { left: 20, top: 10, right: 31, bottom: 13 }, [255, 0, 0, 255]);
    paint(diff, { left: 90, top: 40, right: 91, bottom: 41 }, [255, 255, 0, 255]);
    assert.deepEqual(changedArea(diff), { left: 20, top: 10, right: 30, bottom: 12 });
  });

  test('crops a small change to the minimum width around it, inside the page', () => {
    assert.deepEqual(cropArea({ left: 700, top: 1000, right: 710, bottom: 1010 }, 1440, 7000), {
      left: 386, top: 920, right: 1026, bottom: 1091, continues: false,
    });
    assert.deepEqual(cropArea({ left: 5, top: 5, right: 10, bottom: 10 }, 375, 800), {
      left: 0, top: 0, right: 375, bottom: 91, continues: false,
    });
  });

  test('limits the crop height and says that the difference continues below', () => {
    const area = cropArea({ left: 0, top: 100, right: 1439, bottom: 5000 }, 1440, 7000);
    assert.equal(area.top, 20);
    assert.equal(area.bottom, 820);
    assert.equal(area.continues, true);
    assert.equal(area.right - area.left, 1440);
  });

  test('cuts panels wider than the description column into equal slices', () => {
    assert.deepEqual(slices(0, 1440, maxPanelWidth), [{ left: 0, right: 720 }, { left: 720, right: 1440 }]);
    assert.deepEqual(slices(100, 740, maxPanelWidth), [{ left: 100, right: 740 }]);
    for (const width of [375, 849, 1440, 2000, 3000]) {
      for (const slice of slices(0, width, maxPanelWidth)) assert.ok(slice.right - slice.left <= maxPanelWidth);
    }
  });

  test('changed panels never make an image wider than the description column', () => {
    const before = image(1440, 900);
    const after = paint(image(1440, 900), { left: 0, top: 300, right: 1440, bottom: 320 });
    const { panels } = compareShot(before, after);
    assert.equal(panels.length, 6);
    assert.deepEqual(panels.map((panel) => panel.label).slice(0, 3), ['Before, columns 0 to 720', 'After, columns 0 to 720', 'Diff, columns 0 to 720']);
    assert.ok(sheetWidth(panels.map((panel) => panel.png.width)) <= maxImageWidth);
  });

  test('puts panels side by side only while the image fits the description column', () => {
    assert.equal(sheetColumns([200, 200, 200]), 3);
    assert.equal(sheetColumns([375, 375, 375]), 2);
    assert.equal(sheetColumns([375, 375]), 2);
    assert.equal(sheetColumns([640, 640, 640]), 1);
    assert.equal(sheetColumns([848]), 1);
    for (const widths of [[200, 200, 200], [375, 375, 375], [640, 640], [848]]) assert.ok(sheetWidth(widths) <= maxImageWidth);
  });

  test('reports identical screenshots as unchanged and a missing base as a new page', () => {
    assert.equal(compareShot(image(375, 900), image(375, 900)).status, 'unchanged');
    const added = compareShot(undefined, image(1440, 2000));
    assert.equal(added.status, 'new');
    assert.equal(added.bottom, 800);
    assert.equal(added.continues, true);
    assert.equal(added.panels.length, 2);
  });

  test('pads screenshots of different heights before comparing them', () => {
    const padded = pad(image(10, 5), 10, 8);
    assert.equal(padded.height, 8);
    assert.deepEqual([...padded.data.subarray(10 * 7 * 4, 10 * 7 * 4 + 4)], [128, 128, 128, 255]);
    assert.deepEqual(crop(padded, { left: 2, top: 1, right: 6, bottom: 4 }).width, 4);
  });

  test('draws light and dark once when they give the same image', () => {
    const groups = [];
    const light = { ...parseShot('post.desktop-light.png'), hash: 'a' };
    const dark = { ...parseShot('post.desktop-dark.png'), hash: 'a' };
    const mobile = { ...parseShot('post.mobile-dark.png'), hash: 'a' };
    assert.equal(addToGroups(groups, light), true);
    assert.equal(addToGroups(groups, dark), false);
    assert.equal(addToGroups(groups, mobile), true);
    assert.equal(addToGroups(groups, { ...parseShot('post.mobile-light.png'), hash: 'b' }), true);
    assert.deepEqual(groups.map((group) => [group.device, group.colorSchemes]), [
      ['desktop', ['light', 'dark']],
      ['mobile', ['dark']],
      ['mobile', ['light']],
    ]);
  });

  test('describes the shown area of a change', () => {
    const change = { status: 'changed', ratio: 0.0123, top: 20, bottom: 820, height: 7000, left: 0, right: 1440, continues: true };
    assert.equal(describeChange(change), '1.2% of pixels differ. Shown: rows 20 to 820 of 7000, columns 0 to 1440; the difference continues below.');
    assert.equal(describeChange({ status: 'new', top: 0, bottom: 800, height: 900, continues: true }), 'new page. Shown: rows 0 to 800 of 900; the page continues below.');
  });

  test('writes the count first and collapses the changes and every page', () => {
    const results = ['post.desktop-light.png', 'post.desktop-dark.png'].map((file) => ({ ...parseShot(file), status: 'changed' }));
    const changes = [{ ...results[0], colorSchemes: ['light', 'dark'], ratio: 0.5, top: 0, bottom: 10, height: 10, left: 0, right: 640 }];
    const pages = [{ page: 'post', images: [{ name: 'post.desktop.png', label: 'desktop' }] }];
    const text = summary({ results, changes, pages, hasBase: true, url: (path) => `u/${path}` });
    assert.equal(text.split('\n')[0], '**2 screenshots of 1 pages: 2 changed.**');
    assert.equal(text.split('\n')[1], '');
    assert.equal(text.match(/<details>/g).length, 3);
    assert.equal(text.match(/<\/details>/g).length, 3);
    assert.match(text, /<summary>Changes on post<\/summary>\n\n\*\*post, desktop, light and dark\*\*/);
    assert.match(text, /!\[post desktop\]\(u\/changes\/post\.desktop-light\.png\)/);
    assert.match(text, /Full pages: \[desktop, light\]\(u\/full\/post\.desktop-light\.png\) · \[desktop, dark\]\(u\/full\/post\.desktop-dark\.png\)/);
  });

  test('says that no page changed and leaves out the changes section', () => {
    const results = [{ ...parseShot('post.mobile-light.png'), status: 'unchanged' }];
    const text = summary({ results, changes: [], pages: [], hasBase: true, url: (path) => path });
    assert.equal(text, '**1 screenshots of 1 pages: 1 unchanged.**\nNo page looks different from the base.\n\n');
  });
});
