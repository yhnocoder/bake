function element(tagName, properties = {}, children = []) {
  const created = document.createElement(tagName);
  Object.assign(created, properties);
  created.append(...children);
  return created;
}

function numberControl(definition, value, { commit, preview }) {
  const box = element('input', { type: 'number', value: value ?? '' });
  if (definition.step !== undefined) box.step = String(definition.step);
  box.addEventListener('change', () => commit(box.value));
  if (definition.min === undefined || definition.max === undefined) return [box];
  const slider = element('input', { type: 'range', min: String(definition.min), max: String(definition.max) });
  if (definition.step !== undefined) slider.step = String(definition.step);
  slider.value = value ?? '';
  slider.addEventListener('input', () => {
    box.value = slider.value;
    preview?.(slider.value);
  });
  slider.addEventListener('change', () => commit(slider.value));
  return [slider, box];
}

function enumControl(definition, value, { commit }) {
  const select = element('select');
  if (definition.default === undefined) select.append(element('option', { value: '', textContent: '（未设置）' }));
  for (const option of definition.options) select.append(element('option', { value: option, textContent: option }));
  select.value = value ?? '';
  select.addEventListener('change', () => commit(select.value));
  return [select];
}

function booleanControl(definition, value, { commit }) {
  const input = element('input', { type: 'checkbox', checked: value === true });
  input.setAttribute('role', 'switch');
  input.addEventListener('change', () => commit(input.checked));
  return [input];
}

function listControl(definition, value, { commit }) {
  const textarea = element('textarea', { rows: 3, value: (value ?? []).join('\n') });
  textarea.addEventListener('change', () => {
    commit(textarea.value.split('\n').map((line) => line.trim()).filter((line) => line !== ''));
  });
  return [textarea];
}

function stringControl(definition, value, { commit, placeholder }) {
  const input = element('input', { type: 'text', value: value ?? '' });
  if (placeholder) input.placeholder = placeholder;
  input.addEventListener('change', () => commit(input.value));
  return [input];
}

const controls = { number: numberControl, enum: enumControl, boolean: booleanControl, list: listControl };

export function field({ key, definition, value, error, placeholder, commit, preview }) {
  const message = element('p', { className: 'bake-field-error', textContent: error ?? '', hidden: !error });
  const report = (result) => {
    message.textContent = result ?? '';
    message.hidden = !result;
  };
  const create = controls[definition.type] ?? stringControl;
  const inputs = create(definition, value, { commit: (raw) => report(commit(raw)), preview, placeholder });
  const label = element('label', { className: 'bake-field-label', textContent: definition.label ?? key });
  label.htmlFor = `bake-field-${key}`;
  inputs.at(-1).id = `bake-field-${key}`;
  const wrapper = element('div', { className: `bake-field bake-field-${definition.type}` }, [label, element('div', { className: 'bake-field-controls' }, inputs), message]);
  wrapper.dataset.key = key;
  return wrapper;
}
