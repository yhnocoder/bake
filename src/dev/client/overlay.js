const HIGHLIGHT_DURATION = 1200;
const HIGHLIGHT_OUTSET = 6;
const NOTICE_DURATION = 8000;
const COPIED_DURATION = 1200;

export function copyText(text) {
  if (navigator.clipboard !== undefined) return navigator.clipboard.writeText(text);
  // why: navigator.clipboard exists only in secure contexts, and bake dev opened from another device on the local network is plain http
  const field = document.createElement('textarea');
  field.value = text;
  field.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.append(field);
  field.select();
  document.execCommand('copy');
  field.remove();
  return Promise.resolve();
}

export function createOverlay() {
  const host = document.createElement('div');
  host.id = 'bake-dev';
  host.dataset.bakeDev = '';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = [
    '<link rel="stylesheet" href="/__bake/overlay.css"><link rel="stylesheet" href="/__bake/switch.css">',
    '<div class="marks"></div>',
    '<div class="bar">',
    '<button type="button" class="notice" hidden></button>',
    '<button type="button" class="dot" data-state="clear" aria-label="Show the problems list" title="No problems"></button>',
    '<section class="problems" data-state="clear" hidden aria-label="Problems">',
    '<header><span class="status" aria-hidden="true"></span><span class="title">No problems</span>',
    '<label class="bars" hidden><input type="checkbox" role="switch" class="switch">Parameter bars</label>',
    '<button type="button" class="copy-all" hidden>Copy all</button>',
    '<button type="button" class="close" aria-label="Close the problems list" title="Close">',
    '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    '</button></header>',
    '<div class="list"></div>',
    '</section>',
    '</div>',
  ].join('');
  document.body.append(host);
  const panel = shadow.querySelector('.problems');
  const title = shadow.querySelector('.title');
  const list = shadow.querySelector('.list');
  const marks = shadow.querySelector('.marks');
  const copyAll = shadow.querySelector('.copy-all');
  const dot = shadow.querySelector('.dot');
  const notice = shadow.querySelector('.notice');
  let shownProblems = '';
  let closedProblems = null;
  let problemCount = 0;
  let noticeTimer;
  let noticeAction = null;

  const setOpen = (open) => {
    panel.hidden = !open;
    dot.hidden = open;
  };
  const confirmCopy = (element) => {
    element.dataset.copied = '';
    clearTimeout(element.copiedTimer);
    element.copiedTimer = setTimeout(() => delete element.dataset.copied, COPIED_DURATION);
  };

  shadow.querySelector('.close').addEventListener('click', () => {
    closedProblems = shownProblems;
    setOpen(false);
  });
  copyAll.addEventListener('click', () => copyText(shownProblems).then(() => confirmCopy(copyAll)));
  dot.addEventListener('click', () => {
    closedProblems = null;
    setOpen(true);
  });
  notice.addEventListener('click', () => {
    notice.hidden = true;
    noticeAction?.();
  });

  const problemButton = (problem) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'problem';
    button.title = `Copy ${problem.position}`;
    const where = document.createElement('span');
    where.className = 'where';
    where.textContent = problem.location;
    const message = document.createElement('span');
    message.className = 'message';
    message.textContent = problem.message;
    button.append(where, message);
    button.addEventListener('click', () => copyText(problem.position).then(() => confirmCopy(button)));
    return button;
  };

  const fileGroup = (file, entries) => {
    const group = document.createElement('section');
    group.className = 'file';
    const name = document.createElement('h3');
    name.className = 'file-name';
    name.textContent = file;
    const items = document.createElement('ol');
    for (const problem of entries) {
      const item = document.createElement('li');
      item.append(problemButton(problem));
      items.append(item);
    }
    group.append(name, items);
    return group;
  };

  return {
    ready() {
      host.dataset.ready = '';
    },
    showProblems(problems) {
      const previousCount = problemCount;
      problemCount = problems.length;
      shownProblems = problems.map((problem) => problem.text).join('\n');
      const count = problems.length === 1 ? '1 problem' : `${problems.length} problems`;
      title.textContent = problems.length === 0 ? 'No problems' : count;
      panel.dataset.state = problems.length === 0 ? 'clear' : 'problems';
      copyAll.hidden = problems.length === 0;
      dot.title = problems.length === 0 ? 'No problems' : count;
      dot.dataset.state = panel.dataset.state;
      if (problems.length > 0) dot.textContent = String(problems.length);
      list.replaceChildren(...[...Map.groupBy(problems, (problem) => problem.file)].map(([file, entries]) => fileGroup(file, entries)));
      if (problems.length > 0 && closedProblems !== shownProblems) setOpen(true);
      if (problems.length === 0 && previousCount > 0) {
        closedProblems = null;
        setOpen(false);
      }
    },
    showBarSwitch(shown, change) {
      const label = shadow.querySelector('.bars');
      const toggle = label.querySelector('input');
      toggle.checked = shown;
      toggle.addEventListener('change', () => change(toggle.checked));
      label.hidden = false;
    },
    hideNotice() {
      clearTimeout(noticeTimer);
      notice.hidden = true;
    },
    showNotice(text, direction, action) {
      notice.textContent = text;
      notice.dataset.direction = direction;
      noticeAction = action;
      notice.hidden = false;
      clearTimeout(noticeTimer);
      noticeTimer = setTimeout(() => {
        notice.hidden = true;
      }, NOTICE_DURATION);
    },
    mark(element) {
      const box = element.getBoundingClientRect();
      const origin = marks.getBoundingClientRect();
      const left = Math.max(box.left - HIGHLIGHT_OUTSET, 0);
      const right = Math.min(box.right + HIGHLIGHT_OUTSET, document.documentElement.clientWidth);
      const mark = document.createElement('div');
      mark.className = 'mark';
      mark.dataset.line = element.dataset.line;
      Object.assign(mark.style, {
        left: `${left - origin.left}px`,
        top: `${box.top - origin.top - HIGHLIGHT_OUTSET}px`,
        width: `${right - left}px`,
        height: `${box.height + 2 * HIGHLIGHT_OUTSET}px`,
      });
      marks.append(mark);
      const keyframes = [{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 1, offset: 0.5 }, { opacity: 0 }];
      const animation = mark.animate(keyframes, { id: 'bake-changed', duration: HIGHLIGHT_DURATION, easing: 'ease-in-out', fill: 'forwards' });
      const remove = () => mark.remove();
      animation.finished.then(remove, remove);
    },
  };
}
