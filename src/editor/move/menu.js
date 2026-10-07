import { applyBlockTransaction } from './apply.js';
import { planCopy, planDelete, planStep, unitAt } from './transactions.js';

let close = null;

export function closeMenu() {
  close?.();
}

export function openMenu(view, pos, anchor) {
  closeMenu();
  const { state } = view;
  const unit = unitAt(state, pos);
  const items = [
    { label: '删除', tr: planDelete(state, unit) },
    { label: '复制一份', tr: planCopy(state, unit) },
    { label: '上移', tr: planStep(state, unit, -1) },
    { label: '下移', tr: planStep(state, unit, 1) },
  ];
  const menu = document.createElement('div');
  menu.className = 'bake-block-menu';
  menu.setAttribute('role', 'menu');
  const onOutside = (event) => {
    if (!menu.contains(event.target)) closeMenu();
  };
  const onKey = (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeMenu();
    view.focus();
  };
  close = () => {
    close = null;
    menu.remove();
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
  };
  for (const item of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.textContent = item.label;
    button.disabled = item.tr === null;
    button.addEventListener('click', () => {
      closeMenu();
      applyBlockTransaction(view, item.tr);
      view.focus();
    });
    menu.append(button);
  }
  const rect = anchor.getBoundingClientRect();
  Object.assign(menu.style, { left: `${rect.left + scrollX}px`, top: `${rect.bottom + scrollY}px` });
  document.body.append(menu);
  document.addEventListener('pointerdown', onOutside, true);
  document.addEventListener('keydown', onKey, true);
}
