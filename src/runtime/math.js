let renderer = null;

function loadRenderer() {
  renderer ??= import('../math/browser.js').then(({ createMathRenderer }) => createMathRenderer({ fontCache: 'local' }));
  return renderer;
}

export async function renderMath(tex, { display = false } = {}) {
  const render = await loadRenderer();
  const { svg } = await render(tex, { display }).catch((error) => {
    throw error instanceof Error ? error : new Error(error.message);
  });
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
  return document.importNode(parsed.documentElement, true);
}
