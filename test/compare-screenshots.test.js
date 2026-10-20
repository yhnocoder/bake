import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { PNG } from 'pngjs';
import {
  addToGroups,
  changedColumns,
  changedPixels,
  changedRows,
  compareShot,
  crop,
  cropColumns,
  cropRows,
  describe as describeChange,
  describeArea,
  maxImageWidth,
  maxPanelWidth,
  neighbourRange,
  pad,
  parseShot,
  sheetColumns,
  sheetGap,
  sheetPadding,
  summary,
  withinRange,
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

function ruled(width, height) {
  const png = image(width, height);
  for (let y = 0; y < height; y += 1) {
    const shade = Math.floor(y / width) * 60;
    paint(png, { left: y % width, top: y, right: (y % width) + 1, bottom: y + 1 }, [shade, shade, shade, 255]);
  }
  return png;
}

function sheetWidth(widths) {
  const columns = sheetColumns(widths);
  return columns * Math.min(Math.max(...widths), maxPanelWidth) + (columns - 1) * sheetGap + 2 * sheetPadding;
}

describe('screenshot comparison', () => {
  test('finds the rows and columns of the changed pixels', () => {
    const diff = paint(image(100, 50), { left: 20, top: 10, right: 31, bottom: 13 }, [255, 0, 0, 255]);
    paint(diff, { left: 90, top: 40, right: 91, bottom: 41 }, [255, 255, 0, 255]);
    assert.deepEqual(changedPixels(diff), { left: 20, top: 10, right: 30, bottom: 12 });
  });

  test('crops a small change to the minimum width around it, inside the page', () => {
    assert.deepEqual(cropColumns({ left: 700, right: 710 }, 1440), { left: 386, right: 1026 });
    assert.deepEqual(cropColumns({ left: 5, right: 10 }, 375), { left: 0, right: 375 });
    assert.deepEqual(cropRows(1000, 1011, 7000), { top: 920, bottom: 1091, continues: false });
  });

  test('limits the crop height and says that the difference continues below', () => {
    assert.deepEqual(cropRows(100, 5000, 7000), { top: 20, bottom: 1220, continues: true });
    assert.deepEqual(cropRows(6900, 6990, 7000), { top: 6820, bottom: 7000, continues: false });
  });

  test('finds inserted rows with a row diff', () => {
    const before = ruled(400, 300);
    const after = image(400, 340);
    PNG.bitblt(before, after, 0, 0, 400, 100, 0, 0);
    paint(after, { left: 100, top: 100, right: 300, bottom: 140 });
    PNG.bitblt(before, after, 0, 100, 400, 200, 0, 140);
    assert.deepEqual(changedRows(before, after), [{ beforeStart: 100, beforeEnd: 100, afterStart: 100, afterEnd: 140 }]);
  });

  test('treats text moved by a fraction of a pixel as unchanged', () => {
    const before = paint(image(400, 200), { left: 50, top: 50, right: 350, bottom: 52 });
    const after = paint(image(400, 200), { left: 50, top: 50, right: 350, bottom: 51 }, [128, 128, 128, 255]);
    paint(after, { left: 50, top: 51, right: 350, bottom: 52 });
    paint(after, { left: 50, top: 52, right: 350, bottom: 53 }, [128, 128, 128, 255]);
    assert.deepEqual(changedRows(before, after), []);
    assert.equal(compareShot(before, after).status, 'unchanged');
  });

  test('ignores a change confined to one row', () => {
    const before = ruled(400, 300);
    const after = paint(ruled(400, 300), { left: 100, top: 150, right: 300, bottom: 151 }, [120, 0, 0, 255]);
    assert.equal(compareShot(before, after).status, 'unchanged');
    paint(after, { left: 100, top: 151, right: 300, bottom: 152 }, [120, 0, 0, 255]);
    assert.equal(compareShot(before, after).status, 'changed');
  });

  test('reports a colour change inside a shape thicker than one pixel', () => {
    const before = paint(image(400, 200), { left: 50, top: 50, right: 350, bottom: 53 });
    const after = paint(image(400, 200), { left: 50, top: 50, right: 350, bottom: 53 }, [51, 51, 51, 255]);
    assert.equal(withinRange(after, 51, neighbourRange(before)(51)), false);
    assert.equal(compareShot(before, after).status, 'changed');
  });

  test('limits the changed columns to the columns that hold content in the changed rows', () => {
    const before = paint(image(1440, 400), { left: 200, top: 100, right: 1200, bottom: 120 });
    const after = paint(image(1440, 440), { left: 200, top: 100, right: 1200, bottom: 120 });
    paint(after, { left: 600, top: 200, right: 800, bottom: 240 });
    assert.deepEqual(changedColumns(before, after, { beforeStart: 200, beforeEnd: 200, afterStart: 200, afterEnd: 240 }), { left: 600, right: 799 });
  });

  test('shows an insertion whole in the before and after panels without a diff panel', () => {
    const before = paint(image(1440, 3000), { left: 300, top: 100, right: 1100, bottom: 120 });
    paint(before, { left: 300, top: 2000, right: 1100, bottom: 2900 });
    const after = paint(image(1440, 3400), { left: 300, top: 100, right: 1100, bottom: 120 });
    paint(after, { left: 400, top: 1000, right: 1000, bottom: 1400 }, [200, 0, 0, 255]);
    paint(after, { left: 300, top: 2400, right: 1100, bottom: 3300 });
    const change = compareShot(before, after);
    assert.equal(change.status, 'changed');
    assert.equal(change.areas.length, 1);
    const [area] = change.areas;
    assert.deepEqual([area.left, area.right], [320, 1080]);
    assert.deepEqual([area.before.top, area.before.bottom], [920, 1080]);
    assert.deepEqual([area.after.top, area.after.bottom], [920, 1480]);
    assert.deepEqual(area.panels.map((panel) => [panel.label, panel.png.width, panel.png.height]), [['Before', 760, 160], ['After', 760, 560]]);
  });

  test('shows separate changes as separate areas', () => {
    const before = ruled(640, 3000);
    const after = paint(ruled(640, 3000), { left: 100, top: 500, right: 200, bottom: 520 });
    paint(after, { left: 100, top: 2000, right: 200, bottom: 2020 });
    const change = compareShot(before, after);
    assert.deepEqual(change.areas.map((area) => [area.after.top, area.after.bottom]), [[420, 600], [1920, 2100]]);
    assert.equal(change.hiddenAreas, 0);
  });

  test('adds a diff panel when the changed rows keep their height', () => {
    const before = ruled(375, 900);
    const after = paint(ruled(375, 900), { left: 0, top: 300, right: 375, bottom: 320 });
    const [area] = compareShot(before, after).areas;
    assert.deepEqual(area.panels.map((panel) => panel.label), ['Before', 'After', 'Diff']);
    assert.deepEqual([area.after.top, area.after.bottom, area.left, area.right], [220, 400, 0, 375]);
    assert.equal(sheetColumns(area.panels.map((panel) => panel.png.width)), 2);
  });

  test('never cuts a wide panel and fits the image to the report width', () => {
    const [area] = compareShot(ruled(1440, 900), paint(ruled(1440, 900), { left: 0, top: 300, right: 1440, bottom: 320 })).areas;
    assert.deepEqual(area.panels.map((panel) => panel.png.width), [1440, 1440, 1440]);
    assert.equal(sheetColumns([1440, 1440, 1440]), 1);
    assert.ok(sheetWidth([1440, 1440, 1440]) <= maxImageWidth);
  });

  test('puts panels side by side only while the image fits the report width', () => {
    assert.equal(sheetColumns([200, 200, 200]), 3);
    assert.equal(sheetColumns([375, 375, 375]), 2);
    assert.equal(sheetColumns([375, 375]), 2);
    assert.equal(sheetColumns([640, 640, 640]), 1);
    assert.equal(sheetColumns([872]), 1);
    for (const widths of [[200, 200, 200], [375, 375, 375], [640, 640], [872], [1440, 1440]]) assert.ok(sheetWidth(widths) <= maxImageWidth);
  });

  test('reports identical screenshots as unchanged and a missing base as a new page', () => {
    assert.equal(compareShot(image(375, 900), image(375, 900)).status, 'unchanged');
    const added = compareShot(undefined, image(1440, 2000));
    assert.equal(added.status, 'new');
    assert.equal(added.afterHeight, 2000);
    assert.deepEqual(added.areas[0].after, { left: 0, right: 1440, top: 0, bottom: 1200, continues: true });
    assert.deepEqual(added.areas[0].panels.map((panel) => [panel.label, panel.png.width]), [['New page', 1440]]);
  });

  test('pads a narrower screenshot to the width of the other one', () => {
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

  test('describes the changed areas', () => {
    const long = { left: 0, right: 1440, before: { top: 20, bottom: 1220, continues: true }, after: { top: 20, bottom: 1220, continues: true } };
    assert.equal(describeChange({ status: 'changed', beforeHeight: 7000, afterHeight: 7000, areas: [long], hiddenAreas: 0 }),
      '1 changed area; the page keeps its height of 7000 pixels. Rows 20 to 1220, columns 0 to 1440; the area continues below.');
    const inserted = { left: 300, right: 1140, before: { top: 920, bottom: 1080 }, after: { top: 920, bottom: 1480 } };
    assert.equal(describeArea(inserted), 'Rows 920 to 1080 before and 920 to 1480 after, columns 300 to 1140.');
    assert.equal(describeChange({ status: 'changed', beforeHeight: 3000, afterHeight: 3400, areas: [inserted, inserted, inserted, inserted], hiddenAreas: 2 }),
      '6 changed areas; the page is 400 pixels taller. Only the first 4 are shown.');
    assert.equal(describeChange({ status: 'new', afterHeight: 1500, areas: [{ after: { top: 0, bottom: 1200, continues: true } }] }), 'New page, 1500 pixels tall. Shown: the top 1200 rows.');
    assert.equal(describeChange({ status: 'removed', beforeHeight: 900, areas: [{ before: { top: 0, bottom: 900, continues: false } }] }), 'Removed page, 900 pixels tall.');
  });

  test('writes the count first and collapses the changes and every page', () => {
    const results = ['post.desktop-light.png', 'post.desktop-dark.png'].map((file) => ({ ...parseShot(file), status: 'changed' }));
    const rows = { top: 0, bottom: 10 };
    const areas = [1, 2].map((index) => ({ left: 0, right: 640, before: rows, after: rows, image: `post.desktop-light.${index}.png` }));
    const changes = [{ ...results[0], colorSchemes: ['light', 'dark'], beforeHeight: 10, afterHeight: 10, areas, hiddenAreas: 0 }];
    const pages = [{ page: 'post', images: [{ name: 'post.desktop.png', label: 'desktop' }] }];
    const text = summary({ results, changes, pages, hasBase: true });
    assert.equal(text.split('\n')[0], '**2 screenshots of 1 pages: 2 changed.**');
    assert.equal(text.split('\n')[1], '');
    assert.equal(text.match(/<details>/g).length, 3);
    assert.equal(text.match(/<\/details>/g).length, 3);
    assert.match(text, /<summary>Changes on post<\/summary>\n\n\*\*post, desktop, light and dark\*\*: 2 changed areas/);
    assert.match(text, /Area 2: Rows 0 to 10, columns 0 to 640\.\n\n!\[post desktop\]\(changes\/post\.desktop-light\.2\.png\)/);
    assert.ok(!text.includes('full/'));
  });

  test('says that no page changed and leaves out the changes section', () => {
    const results = [{ ...parseShot('post.mobile-light.png'), status: 'unchanged' }];
    const text = summary({ results, changes: [], pages: [], hasBase: true });
    assert.equal(text, '**1 screenshots of 1 pages: 1 unchanged.**\nNo page looks different from the base.\n\n');
  });
});
