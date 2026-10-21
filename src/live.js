// why: src/dev/client/client.js dispatches this event after each partial update; the dev server sends that file unbundled, so it cannot import this name
const UPDATE_EVENT = 'bake:update';

export function livePage(start) {
  let dispose = start(document);
  document.addEventListener(UPDATE_EVENT, () => {
    dispose();
    dispose = start(document);
  });
}
