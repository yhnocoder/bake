import './status.css';

const root = document.createElement('div');
root.className = 'bake-status';
root.dataset.bakeDev = '';
root.innerHTML = `<div class="bake-status-bar"><div class="bake-status-controls"></div><button type="button" class="bake-status-problems" aria-expanded="false"></button></div><ol class="bake-status-list" hidden></ol>`;
const problems = root.querySelector('.bake-status-problems');
const list = root.querySelector('.bake-status-list');
document.body.append(root);

problems.addEventListener('click', () => {
  const expanded = problems.getAttribute('aria-expanded') !== 'true';
  problems.setAttribute('aria-expanded', String(expanded));
  list.hidden = !expanded || list.children.length === 0;
});

function summary(errors, links) {
  const parts = [];
  if (errors.length > 0) parts.push(`${errors.length} 个渲染错误`);
  if (links.length > 0) parts.push(`${links.length} 个断开的站内链接`);
  return parts.length === 0 ? '没有错误' : parts.join('，');
}

export function statusControls() {
  return root.querySelector('.bake-status-controls');
}

export function showStatus({ errors, links }) {
  problems.textContent = summary(errors, links);
  problems.classList.toggle('has-problems', errors.length + links.length > 0);
  list.replaceChildren(
    ...[...errors, ...links].map(({ path, line, column, text }) => {
      const item = document.createElement('li');
      item.textContent = `${path}:${line}:${column} ${text}`;
      return item;
    }),
  );
  list.hidden = problems.getAttribute('aria-expanded') !== 'true' || list.children.length === 0;
}
