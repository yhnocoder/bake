const FRAMES = '[data-region] figure.component[data-line]';
const BAR = 'bake-param-bar';
const MESSAGE_DURATION = 4000;

export function startParamBars({ file, version, setVersion, components, copyText, shown }) {
  let visible = shown;
  const server = { file, version, setVersion, copyText };

  function scan() {
    const declared = components();
    for (const frame of document.querySelectorAll(FRAMES)) {
      const box = frame.querySelector(':scope > .component-box');
      const params = declared[frame.dataset.component];
      if (box === null || frame.querySelector(`:scope > ${BAR}`) !== null || params === undefined || Object.keys(params).length === 0) continue;
      const bar = createBar(frame, params, server);
      bar.hidden = !visible;
      box.before(bar);
    }
  }

  scan();
  document.addEventListener('bake:content', scan);
  return {
    setShown(value) {
      visible = value;
      for (const bar of document.querySelectorAll(BAR)) bar.hidden = !value;
    },
  };
}

function createBar(frame, declarations, server) {
  const name = frame.dataset.component;
  const host = document.createElement(BAR);
  host.dataset.bakeDev = '';
  const shadow = host.attachShadow({ mode: 'open' });
  const stylesheet = element('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = '/__bake/param-bar.css';
  const bar = element('div', 'bar');
  const message = element('p', 'message');
  message.hidden = true;
  message.setAttribute('role', 'status');
  shadow.append(stylesheet, bar);

  const markdown = { ...JSON.parse(frame.dataset.params) };
  const current = { ...markdown };
  let waiting = false;
  let messageTimer;

  const controls = Object.entries(declarations).map(([param, declaration]) =>
    createControl(param, declaration, current[param], (value) => {
      current[param] = value;
      clearMessage();
      refreshMarks();
      apply();
    }),
  );
  const write = button('Write to file', 'write');
  const copy = button('Copy', 'copy');
  const reset = button('Reset', 'reset');
  const actions = element('div', 'actions');
  actions.append(write, copy, reset);
  const title = element('code', 'name');
  title.textContent = name;
  bar.append(title, ...controls.map((control) => control.element), actions, message);
  refreshMarks();

  new MutationObserver(() => {
    if (waiting && frame.dataset.state === 'ready') apply();
  }).observe(frame, { attributes: true, attributeFilter: ['data-state'] });

  write.addEventListener('click', () =>
    run(true, (data) => {
      server.setVersion(data.version);
      Object.assign(markdown, current);
      refreshMarks();
      showMessage(`Wrote line ${frame.dataset.line} of ${server.file}`, 'done');
    }),
  );
  copy.addEventListener('click', () =>
    run(false, async (data) => {
      await server.copyText(data.line);
      showMessage(`Copied line ${frame.dataset.line} with these values`, 'done');
    }),
  );
  reset.addEventListener('click', () => {
    Object.assign(current, markdown);
    for (const control of controls) control.set(current[control.param]);
    refreshMarks();
    apply();
    showMessage('Reset to the values in the Markdown', 'done');
  });

  function apply() {
    const live = frame.querySelector(`:scope > .component-box > ${name}`);
    waiting = frame.dataset.state !== 'ready' || live === null;
    if (waiting) return;
    live.params = { ...current };
    live.update?.();
  }

  function refreshMarks() {
    let changed = false;
    for (const control of controls) {
      const differs = current[control.param] !== markdown[control.param];
      control.element.toggleAttribute('data-changed', differs);
      control.element.title = differs ? `Not written yet; the Markdown gives ${JSON.stringify(markdown[control.param])}` : '';
      changed ||= differs;
    }
    write.disabled = !changed;
    reset.disabled = !changed;
  }

  async function run(writeFile, done) {
    clearMessage();
    try {
      const response = await fetch('/__bake/params', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file: server.file, version: server.version(), line: Number(frame.dataset.line), name, params: { ...current }, write: writeFile }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      await done(data);
    } catch (error) {
      showMessage(error instanceof Error ? error.message : String(error), 'error');
    }
  }

  function showMessage(text, kind) {
    clearTimeout(messageTimer);
    message.textContent = text;
    message.dataset.kind = kind;
    message.hidden = false;
    if (kind === 'done') messageTimer = setTimeout(clearMessage, MESSAGE_DURATION);
  }

  function clearMessage() {
    clearTimeout(messageTimer);
    message.hidden = true;
  }

  return host;
}

function createControl(param, declaration, value, change) {
  const wrapper = element('div', 'control');
  wrapper.dataset.param = param;
  wrapper.dataset.type = declaration.type;
  const label = element('span', 'label');
  label.textContent = declaration.label;
  wrapper.append(label);
  const input = (type, className) => {
    const field = element(type === 'select' ? 'select' : 'input', className);
    if (type !== 'select') field.type = type;
    field.setAttribute('aria-label', declaration.label);
    wrapper.append(field);
    return field;
  };
  const control = { param, element: wrapper };

  if (declaration.type === 'number') {
    const { min, max, step } = declaration;
    const ranged = min !== undefined && max !== undefined;
    const slider = ranged ? input('range', 'slider') : null;
    const number = input('number', 'number');
    for (const field of [slider, number].filter(Boolean)) {
      if (min !== undefined) field.min = String(min);
      if (max !== undefined) field.max = String(max);
      field.step = step === undefined ? 'any' : String(step);
    }
    const digits = decimals(step, min, max);
    slider?.addEventListener('input', () => {
      const next = Number(Number(slider.value).toFixed(digits));
      number.value = String(next);
      wrapper.removeAttribute('data-invalid');
      change(next);
    });
    number.addEventListener('input', () => {
      const next = Number(number.value);
      const valid = number.value.trim() !== '' && Number.isFinite(next) && !(min !== undefined && next < min) && !(max !== undefined && next > max);
      wrapper.toggleAttribute('data-invalid', !valid);
      if (!valid) return;
      if (slider !== null) slider.value = String(next);
      change(next);
    });
    control.set = (next) => {
      number.value = String(next);
      if (slider !== null) slider.value = String(next);
      wrapper.removeAttribute('data-invalid');
    };
  } else if (declaration.type === 'enum') {
    const select = input('select', 'select');
    select.append(
      ...declaration.options.map((option) => {
        const choice = element('option');
        choice.value = option;
        choice.textContent = option;
        return choice;
      }),
    );
    select.addEventListener('change', () => change(select.value));
    control.set = (next) => {
      select.value = next;
    };
  } else if (declaration.type === 'boolean') {
    const toggle = input('checkbox', 'switch');
    toggle.setAttribute('role', 'switch');
    toggle.addEventListener('change', () => change(toggle.checked));
    control.set = (next) => {
      toggle.checked = next;
    };
  } else {
    const field = input('text', 'text');
    field.spellcheck = false;
    field.addEventListener('input', () => change(field.value));
    control.set = (next) => {
      field.value = next;
    };
  }
  control.set(value);
  return control;
}

function decimals(step, min, max) {
  if (step !== undefined) {
    const [digits, exponent] = String(step).split('e-');
    return (digits.split('.')[1]?.length ?? 0) + Number(exponent ?? 0);
  }
  if (min === undefined || max === undefined || max <= min) return 6;
  return Math.min(10, Math.max(0, 2 - Math.floor(Math.log10(max - min))));
}

function button(text, className) {
  const control = element('button', className);
  control.type = 'button';
  control.textContent = text;
  return control;
}

function element(tag, className) {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  return node;
}
