(() => {
  const script = document.currentScript;
  const { source, missing } = script.dataset;
  const scrollKey = `bake-dev-scroll:${location.pathname}`;
  const pagePath = location.pathname.replace(/index\.html$/, '');
  const BLOCKS = '[data-region] [data-line]';
  const HIGHLIGHT_DURATION = 1200;
  const HIGHLIGHT_OUTSET = 6;
  const NOTICE_DURATION = 8000;
  const COPIED_DURATION = 1200;

  let pristine = null;
  let outline = JSON.parse(script.dataset.outline ?? '[]');
  let serverId = null;
  let refreshing = null;
  let refreshAgain = false;

  const ui = createInterface();
  restoreScroll();
  const loaded =
    missing === undefined
      ? fetchPage().then((page) => {
          if (page.ok) pristine = page.document;
        })
      : Promise.resolve();
  const connected = connect();
  Promise.all([loaded, connected]).then(ui.ready);
  document.addEventListener('dblclick', openInEditor);

  function connect() {
    const events = new EventSource('/__bake/events');
    const connected = new Promise((done) => events.addEventListener('hello', done, { once: true }));
    events.addEventListener('hello', (event) => {
      const { id } = JSON.parse(event.data);
      if (serverId !== null && serverId !== id) reloadPage();
      serverId = id;
    });
    events.addEventListener('problems', (event) => ui.showProblems(JSON.parse(event.data)));
    events.addEventListener('update', (event) => {
      const { reload, refresh } = JSON.parse(event.data);
      if (missing !== undefined || reload === 'all' || reload.includes(pagePath)) reloadPage();
      else if (refresh.includes(pagePath)) queueRefresh();
    });
    return connected;
  }

  async function fetchPage() {
    const response = await fetch(location.pathname, { cache: 'no-store' });
    const text = await response.text();
    return { ok: response.ok, document: new DOMParser().parseFromString(text, 'text/html') };
  }

  function queueRefresh() {
    if (refreshing !== null) {
      refreshAgain = true;
      return;
    }
    refreshing = refresh().finally(() => {
      refreshing = null;
      if (refreshAgain) {
        refreshAgain = false;
        queueRefresh();
      }
    });
  }

  async function refresh() {
    const page = await fetchPage();
    const next = page.document;
    if (!page.ok || pristine === null || skeleton(next) !== skeleton(pristine)) {
      reloadPage();
      return;
    }
    ui.hideNotice();
    const lines = changedLines(pristine, next);
    const anchor = findAnchor(pristine, next);
    const details = detailsState();
    const replaced = replaceRegions(pristine, next);
    pristine = next;
    outline = JSON.parse(next.querySelector('script[data-bake-dev]')?.dataset.outline ?? '[]');
    if (!replaced) return;
    restoreDetails(details);
    document.dispatchEvent(new CustomEvent('bake:content'));
    if (anchor !== null) {
      anchor.align();
      requestAnimationFrame(() => requestAnimationFrame(anchor.align));
    }
    showChanges(lines);
  }

  function skeleton(doc) {
    const copy = doc.documentElement.cloneNode(true);
    for (const element of copy.querySelectorAll('[data-bake-dev]')) element.remove();
    for (const region of copy.querySelectorAll('[data-region]')) region.replaceChildren();
    return copy.outerHTML;
  }

  function regionSelector(name) {
    return `[data-region="${CSS.escape(name)}"]`;
  }

  function replaceRegions(old, next) {
    let replaced = false;
    for (const region of next.querySelectorAll('[data-region]')) {
      const selector = regionSelector(region.dataset.region);
      if (old.querySelector(selector)?.innerHTML === region.innerHTML) continue;
      for (const live of document.querySelectorAll(selector)) {
        live.replaceChildren(...[...region.childNodes].map((node) => document.importNode(node, true)));
      }
      replaced = true;
    }
    return replaced;
  }

  function blocksOf(doc) {
    return [...doc.querySelectorAll(BLOCKS)].map((element) => ({ line: element.dataset.line, signature: signature(element) }));
  }

  function signature(element) {
    const copy = element.cloneNode(true);
    for (const part of [copy, ...copy.querySelectorAll('[data-line]')]) {
      part.removeAttribute('data-line');
      part.removeAttribute('data-end-line');
    }
    return copy.outerHTML;
  }

  function changedLines(old, next) {
    const counts = new Map();
    for (const { signature } of blocksOf(old)) counts.set(signature, (counts.get(signature) ?? 0) + 1);
    const lines = [];
    for (const { line, signature } of blocksOf(next)) {
      const count = counts.get(signature) ?? 0;
      if (count > 0) counts.set(signature, count - 1);
      else lines.push(line);
    }
    return lines;
  }

  function visibleBlock(line) {
    return [...document.querySelectorAll(`${BLOCKS}[data-line="${CSS.escape(line)}"]`)].find(isShown) ?? null;
  }

  function isShown(element) {
    return element.checkVisibility() && element.getClientRects().length > 0;
  }

  function findAnchor(old, next) {
    const element = [...document.querySelectorAll(BLOCKS)].find((candidate) => isShown(candidate) && candidate.getBoundingClientRect().top >= 0);
    if (element === undefined) return null;
    const top = element.getBoundingClientRect().top;
    const before = blocksOf(old);
    const index = before.findIndex((block) => block.line === element.dataset.line);
    if (index === -1) return null;
    const { signature } = before[index];
    const occurrence = before.slice(0, index).filter((block) => block.signature === signature).length;
    const match = blocksOf(next).filter((block) => block.signature === signature)[occurrence];
    if (match === undefined) return null;
    return {
      align: () => {
        const target = visibleBlock(match.line);
        if (target !== null) scrollBy({ top: target.getBoundingClientRect().top - top, behavior: 'instant' });
      },
    };
  }

  function detailsKeys() {
    const seen = new Map();
    return [...document.querySelectorAll('[data-region] details')].map((details) => {
      const title = details.querySelector(':scope > summary')?.textContent.trim() ?? '';
      const count = seen.get(title) ?? 0;
      seen.set(title, count + 1);
      return { details, key: `${title}\n${count}` };
    });
  }

  function detailsState() {
    return new Map(detailsKeys().map(({ details, key }) => [key, details.open]));
  }

  function restoreDetails(state) {
    for (const { details, key } of detailsKeys()) {
      if (state.has(key)) details.open = state.get(key);
    }
  }

  function showChanges(lines) {
    const changed = new Set(lines);
    const elements = [...document.querySelectorAll(BLOCKS)].filter((element) => changed.has(element.dataset.line));
    elements.forEach(highlight);
    const shown = elements.filter(isShown);
    if (shown.length === 0) return;
    const boxes = shown.map((element) => element.getBoundingClientRect());
    if (boxes.some((box) => box.bottom > 0 && box.top < innerHeight)) return;
    const first = shown[0];
    const direction = boxes[0].top < 0 ? 'above' : 'below';
    ui.showNotice(`Changed ${direction} in ${sectionOf(Number(first.dataset.line))}`, direction, () => {
      first.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
      shown.forEach(highlight);
    });
  }

  function highlight(element) {
    ui.mark(element);
  }

  function sectionOf(line) {
    const entry = outline.findLast((candidate) => candidate.line <= line);
    return entry === undefined ? 'the introduction' : entry.title;
  }

  function reloadPage() {
    try {
      sessionStorage.setItem(scrollKey, String(scrollY));
    } catch {}
    location.reload();
  }

  function restoreScroll() {
    let saved = null;
    try {
      saved = sessionStorage.getItem(scrollKey);
      sessionStorage.removeItem(scrollKey);
    } catch {}
    if (saved === null) return;
    history.scrollRestoration = 'manual';
    const apply = () => scrollTo({ top: Number(saved), behavior: 'instant' });
    apply();
    addEventListener(
      'load',
      () => {
        apply();
        requestAnimationFrame(() => requestAnimationFrame(apply));
        document.fonts.ready.then(apply);
      },
      { once: true },
    );
  }

  function openInEditor(event) {
    if (source === undefined || !(event.target instanceof Element) || event.target.closest('input, textarea, select') !== null) return;
    const block = event.target.closest(BLOCKS);
    if (block === null) return;
    window.open(`vscode://file${source}:${block.dataset.line}:1`, '_self');
  }

  function copyText(text) {
    if (navigator.clipboard !== undefined) return navigator.clipboard.writeText(text);
    const field = document.createElement('textarea');
    field.value = text;
    field.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.append(field);
    field.select();
    document.execCommand('copy');
    field.remove();
    return Promise.resolve();
  }

  function createInterface() {
    const host = document.createElement('div');
    host.id = 'bake-dev';
    host.dataset.bakeDev = '';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = [
      '<link rel="stylesheet" href="/__bake/client.css">',
      '<div class="marks"></div>',
      '<div class="bar">',
      '<button type="button" class="notice" hidden></button>',
      '<button type="button" class="dot" data-state="clear" aria-label="Show the problems list" title="No problems"></button>',
      '<section class="problems" data-state="clear" hidden aria-label="Problems">',
      '<header><span class="status" aria-hidden="true"></span><span class="title">No problems</span>',
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
})();
