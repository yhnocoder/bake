export const SELECTION_CHUNK = /\/assets\/selection-[\w-]+\.js$/;

export function isSelectionChunk(url) {
  return SELECTION_CHUNK.test(new URL(url).pathname);
}

export async function openWithSelectionModule(page, url) {
  const loaded = page.waitForResponse((response) => isSelectionChunk(response.url()));
  await page.goto(url);
  await selectionModuleReady(page, (await loaded).url());
}

export function selectionModuleReady(page, chunk) {
  return page.evaluate(async (chunk) => {
    await import(chunk);
    await new Promise((resolve) => setTimeout(resolve));
  }, chunk);
}
