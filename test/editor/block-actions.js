import { session } from './setup.js';

export function paragraph(page, text) {
  return page.locator('.milkdown .editor p', { hasText: text }).first();
}

export function card(page, title) {
  return page.locator('.milkdown .editor section.card', { hasText: title }).first();
}

export async function frames(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

export async function pointIn(locator, fx = 0.1, fy = 0.5) {
  const box = await locator.boundingBox();
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

export async function hover(page, locator, fx, fy) {
  const point = await pointIn(locator, fx, fy);
  await page.mouse.move(point.x, point.y);
  await frames(page);
  return point;
}

export function visibleHandles(page) {
  return session(page, (current) => {
    const layer = document.querySelector('.bake-block-handles');
    if (!layer || layer.hidden) return [];
    return [...layer.querySelectorAll('.bake-block-handle:not([hidden])')].map((handle) => {
      const pos = Number(handle.dataset.pos);
      const node = current.view.state.doc.nodeAt(pos);
      const box = handle.getBoundingClientRect();
      return { pos, type: node.type.name, text: node.textContent, left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
    });
  });
}

export function dropLineState(page) {
  return page.evaluate(() => {
    const line = document.querySelector('.bake-drop-line');
    if (!line || line.hidden) return null;
    return { direction: line.dataset.direction, ...line.getBoundingClientRect().toJSON() };
  });
}

export async function grab(page, locator, type, fx, fy) {
  await hover(page, locator, fx, fy);
  const handle = (await visibleHandles(page)).find((candidate) => candidate.type === type);
  if (!handle) throw new Error(`No handle for ${type}`);
  await page.mouse.move(handle.left + handle.width / 2, handle.top + handle.height / 2);
  await frames(page);
  return handle;
}

export async function dragTo(page, point) {
  await page.evaluate(() => {
    if (!('bakeTestDragover' in window)) document.addEventListener('dragover', (event) => (window.bakeTestDragover = { x: event.clientX, y: event.clientY }), { capture: true });
    window.bakeTestDragover = null;
  });
  await page.mouse.move(point.x, point.y, { steps: 12 });
  for (let attempt = 0; attempt < 100; attempt++) {
    const last = await page.evaluate(() => window.bakeTestDragover);
    if (last && Math.abs(last.x - point.x) <= 1.5 && Math.abs(last.y - point.y) <= 1.5) break;
    await page.mouse.move(point.x + (attempt % 2 ? 0.5 : -0.5), point.y);
    await page.waitForTimeout(30);
  }
  await frames(page);
}

export async function drag(page, source, type, target, screenshot) {
  await grab(page, source.locator, type, source.fx, source.fy);
  await page.mouse.down();
  const point = typeof target === 'function' ? await target() : await pointIn(target.locator, target.fx, target.fy);
  await dragTo(page, point);
  const line = await dropLineState(page);
  await page.screenshot({ path: screenshot });
  await page.mouse.up();
  await frames(page);
  return line;
}

export async function openMenu(page, locator, type) {
  await grab(page, locator, type);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForSelector('.bake-block-menu');
}

export function menuItems(page) {
  return page.$$eval('.bake-block-menu button', (buttons) => buttons.map((button) => ({ label: button.textContent, disabled: button.disabled })));
}

export async function clickMenu(page, label) {
  await page.click(`.bake-block-menu button:text-is("${label}")`);
}
