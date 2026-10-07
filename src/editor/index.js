import { statusControls } from '../dev/status.js';
import './editor.css';

const controls = statusControls();
const toggle = document.createElement('button');
toggle.type = 'button';
toggle.className = 'bake-edit-toggle';
toggle.textContent = '编辑';
toggle.setAttribute('aria-pressed', 'false');
const propertiesToggle = document.createElement('button');
propertiesToggle.type = 'button';
propertiesToggle.className = 'bake-properties-toggle';
propertiesToggle.textContent = '属性';
propertiesToggle.hidden = true;
const state = document.createElement('span');
state.className = 'bake-save-state';
const actions = document.createElement('span');
actions.className = 'bake-conflict-actions';
controls.append(toggle, propertiesToggle, state, actions);

function button(label, run) {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.addEventListener('click', () => {
    actions.replaceChildren();
    run();
  });
  return element;
}

function show(text, kind) {
  state.textContent = text;
  state.dataset.kind = kind;
  actions.replaceChildren();
}

const status = {
  saved: () => show('已保存', 'saved'),
  saving: () => show('保存中', 'saving'),
  failed: (message) => show(`保存失败：${message}`, 'failed'),
  structureError: () => show('文章有结构错误，修正后才能编辑', 'failed'),
  conflict({ useDisk, keepMine }) {
    show('冲突', 'conflict');
    actions.append(button('使用磁盘上的版本', useDisk), button('保留我的修改并覆盖', keepMine));
  },
  closed: () => show('', 'closed'),
};

let session = null;
let pending = Promise.resolve();

async function switchMode() {
  if (session) {
    await session.close();
    session = null;
  } else {
    const { openEditor } = await import('./session.js');
    session = await openEditor(status);
  }
  toggle.setAttribute('aria-pressed', String(session !== null));
  propertiesToggle.hidden = session === null;
  document.body.classList.toggle('bake-editing', session !== null);
}

propertiesToggle.addEventListener('click', async () => {
  if (!session) return;
  const { toggleProperties } = await import('./properties/state.js');
  toggleProperties(session.view);
});

window.addEventListener('bake:page-updated', () => {
  document.body.classList.toggle('bake-editing', session !== null);
});

toggle.addEventListener('click', () => {
  pending = pending.then(switchMode);
});

export function currentSession() {
  return session;
}
