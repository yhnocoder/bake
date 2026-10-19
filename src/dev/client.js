(() => {
  const script = document.currentScript;
  const { source, missing, file } = script.dataset;
  const scrollKey = `bake-dev-scroll:${location.pathname}`;
  const pagePath = location.pathname.replace(/index\.html$/, '');
  const BLOCKS = '[data-region] [data-line]';
  const HIGHLIGHT = 'rgb(250 204 21 / 0.3)';
  const HIGHLIGHT_END = 'rgb(250 204 21 / 0)';
  const HIGHLIGHT_DURATION = 1000;
  const NOTICE_DURATION = 8000;
  const COPIED_DURATION = 1200;
  const BARS_KEY = 'bake-dev-param-bars';

  let pristine = null;
  let outline = JSON.parse(script.dataset.outline ?? '[]');
  let version = script.dataset.version;
  let components = JSON.parse(script.dataset.components ?? '{}');
  let serverId = null;
  let refreshing = null;
  let refreshAgain = false;

  const ui = createInterface();
  const bars = file === undefined ? null : startBars();
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

  function startBars() {
    const shown = barsShown();
    ui.showBarSwitch(shown, (value) => {
      try {
        localStorage.setItem(BARS_KEY, value ? 'shown' : 'hidden');
      } catch {}
      bars.then((module) => module.setShown(value));
    });
    return import('/__bake/param-bar.js').then((module) =>
      module.startParamBars({
        file,
        version: () => version,
        setVersion: (next) => {
          version = next;
        },
        components: () => components,
        copyText,
        shown,
      }),
    );
  }

  function barsShown() {
    try {
      return localStorage.getItem(BARS_KEY) !== 'hidden';
    } catch {
      return true;
    }
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
    const data = next.querySelector('script[data-bake-dev]')?.dataset ?? {};
    outline = JSON.parse(data.outline ?? '[]');
    version = data.version;
    components = JSON.parse(data.components ?? '{}');
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
    for (const part of [copy, ...copy.querySelectorAll('[data-line]')]) part.removeAttribute('data-line');
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
    const lineElements = [...document.querySelectorAll(BLOCKS)].filter((element) => changed.has(element.dataset.line));
    const elements = lineElements.filter((element) => !lineElements.some((other) => other !== element && other.contains(element)));
    elements.forEach(highlight);
    const shown = elements.filter(isShown);
    if (shown.length === 0) return;
    const boxes = shown.map((element) => element.getBoundingClientRect());
    if (boxes.some((box) => box.bottom > 0 && box.top < innerHeight)) return;
    const first = shown[0];
    const direction = boxes[0].top < 0 ? 'above' : 'below';
    ui.showNotice(`Changed ${direction} in ${sectionOf(Number(first.dataset.line))}`, () => {
      first.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
      shown.forEach(highlight);
    });
  }

  function highlight(element) {
    element.animate(
      [
        { backgroundColor: HIGHLIGHT_END, boxShadow: `0 0 0 4px ${HIGHLIGHT_END}` },
        { backgroundColor: HIGHLIGHT, boxShadow: `0 0 0 4px ${HIGHLIGHT}`, offset: 0.12 },
        { backgroundColor: HIGHLIGHT, boxShadow: `0 0 0 4px ${HIGHLIGHT}`, offset: 0.5 },
        { backgroundColor: HIGHLIGHT_END, boxShadow: `0 0 0 4px ${HIGHLIGHT_END}` },
      ],
      { id: 'bake-changed', duration: HIGHLIGHT_DURATION, easing: 'ease-in-out' },
    );
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
    if (event.composedPath().some((target) => target instanceof Element && target.matches('bake-param-bar'))) return;
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
      '<div class="bar">',
      '<button type="button" class="notice" hidden></button>',
      '<button type="button" class="dot" data-state="clear" aria-label="Show the problems list" title="No problems"></button>',
      '<section class="problems" data-state="clear" hidden aria-label="Problems">',
      '<header><span class="title">No problems</span><label class="bars" hidden><input type="checkbox" role="switch" class="switch">Parameter bars</label><button type="button" class="close" aria-label="Close the problems list">×</button></header>',
      '<ol class="list"></ol>',
      '</section>',
      '</div>',
    ].join('');
    document.body.append(host);
    const panel = shadow.querySelector('.problems');
    const title = shadow.querySelector('.title');
    const list = shadow.querySelector('.list');
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

    shadow.querySelector('.close').addEventListener('click', () => {
      closedProblems = shownProblems;
      setOpen(false);
    });
    dot.addEventListener('click', () => {
      closedProblems = null;
      setOpen(true);
    });
    notice.addEventListener('click', () => {
      notice.hidden = true;
      noticeAction?.();
    });

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
        dot.title = problems.length === 0 ? 'No problems' : count;
        dot.dataset.state = panel.dataset.state;
        if (problems.length > 0) dot.textContent = String(problems.length);
        list.replaceChildren(
          ...problems.map((problem) => {
            const item = document.createElement('li');
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'problem';
            button.title = `Copy ${problem.position}`;
            button.textContent = problem.text;
            button.addEventListener('click', () => {
              copyText(problem.position).then(() => {
                button.dataset.copied = '';
                setTimeout(() => delete button.dataset.copied, COPIED_DURATION);
              });
            });
            item.append(button);
            return item;
          }),
        );
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
      showNotice(text, action) {
        notice.textContent = text;
        noticeAction = action;
        notice.hidden = false;
        clearTimeout(noticeTimer);
        noticeTimer = setTimeout(() => {
          notice.hidden = true;
        }, NOTICE_DURATION);
      },
    };
  }
})();
