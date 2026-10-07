import { closeHistory } from '@milkdown/prose/history';
import { Plugin } from '@milkdown/prose/state';
import { $prose } from '@milkdown/utils';
import { isDefault } from '../../render/block-render.js';
import { field } from './controls.js';
import { attributeDefinitions } from './definitions.js';
import { pageEntries, readPage, writePageField } from './frontmatter.js';
import { pageChrome } from './page-chrome.js';
import { closeProperties, propertiesKey, propertiesState } from './state.js';

function markAt(doc, { from, type }) {
  return doc.nodeAt(from)?.marks.find((mark) => mark.type.name === type) ?? null;
}

function withValue(attributes, key, value) {
  if (value !== undefined) return { ...attributes, [key]: value };
  const { [key]: removed, ...rest } = attributes;
  return rest;
}

function attributeValue(property, raw) {
  if (property.type === 'boolean') return String(raw);
  if (raw.trim() === '') return undefined;
  return property.type === 'number' ? String(Number(raw)) : raw;
}

function displayValue(property, value) {
  const shown = value ?? (property.default === undefined ? undefined : String(property.default));
  if (property.type === 'boolean') return shown === 'true';
  return shown;
}

class PanelView {
  constructor(view, definitions, site) {
    this.view = view;
    this.definitions = definitions;
    this.site = site;
    this.shown = null;
    this.element = document.createElement('aside');
    this.element.className = 'bake-properties';
    this.element.dataset.bakeDev = '';
    this.element.hidden = true;
    this.heading = document.createElement('h2');
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'bake-properties-close';
    close.textContent = '关闭';
    close.addEventListener('click', () => this.close());
    const header = document.createElement('header');
    header.append(this.heading, close);
    this.body = document.createElement('div');
    this.body.className = 'bake-properties-body';
    this.element.append(header, this.body);
    this.element.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      }
    });
    document.body.append(this.element);
    this.restoreClass = () => document.body.classList.toggle('properties-open', propertiesKey.getState(this.view.state).open);
    window.addEventListener('bake:page-updated', this.restoreClass);
    this.update(view);
  }

  close() {
    closeProperties(this.view);
    this.view.focus();
  }

  subject(state) {
    const { target } = propertiesKey.getState(state);
    if (!target) return { kind: 'page', key: `page:${state.doc.attrs.frontmatter}` };
    if (target.pos !== undefined) {
      const node = state.doc.nodeAt(target.pos);
      return { kind: 'node', target, node, definition: this.definitions.node(node), attributes: node.attrs.attributes ?? {}, key: `node:${target.pos}:${node.type.name}:${JSON.stringify(node.attrs.attributes)}` };
    }
    const mark = markAt(state.doc, target);
    if (!mark) return { kind: 'page', key: `page:${state.doc.attrs.frontmatter}` };
    return { kind: 'mark', target, mark, definition: this.definitions.mark(mark), attributes: mark.attrs.attributes ?? {}, key: `mark:${target.from}:${target.to}:${JSON.stringify(mark.attrs.attributes)}` };
  }

  update(view) {
    this.view = view;
    const { open } = propertiesKey.getState(view.state);
    document.body.classList.toggle('properties-open', open);
    this.element.hidden = !open;
    if (!open) {
      this.shown = null;
      return;
    }
    const subject = this.subject(view.state);
    if (subject.key === this.shown) return;
    this.shown = subject.key;
    const focused = this.element.contains(document.activeElement) ? document.activeElement.closest('.bake-field')?.dataset.key : undefined;
    if (subject.kind === 'page') this.renderPage(view.state.doc.attrs.frontmatter);
    else this.renderBlock(subject);
    if (focused) this.body.querySelector(`.bake-field[data-key="${CSS.escape(focused)}"] :is(input, select, textarea)`)?.focus();
  }

  renderBlock({ kind, target, node, mark, definition, attributes }) {
    this.heading.textContent = definition.title;
    const write = (key, value) => {
      const next = withValue(attributes, key, value);
      const empty = Object.keys(next).length === 0 ? definition.empty : next;
      const { tr } = this.view.state;
      if (kind === 'node') tr.setNodeAttribute(target.pos, 'attributes', empty);
      else tr.removeMark(target.from, target.to, mark.type).addMark(target.from, target.to, mark.type.create({ ...mark.attrs, attributes: empty ?? {} }));
      this.view.dispatch(closeHistory(tr));
    };
    const fields = Object.entries(definition.properties).map(([key, property]) =>
      field({
        key,
        definition: property,
        value: displayValue(property, attributes[key]),
        placeholder: node?.type.name === 'heading' && key === 'id' ? this.view.nodeDOM(target.pos)?.id : undefined,
        commit: (raw) => {
          let value = attributeValue(property, raw);
          if (value !== undefined) {
            const error = definition.error(key, value);
            if (error) return error;
            if (isDefault(value, property)) value = undefined;
          }
          if (value !== attributes[key]) write(key, value);
          return null;
        },
        preview: node?.type.name === 'component' ? (raw) => this.view.nodeDOM(target.pos)?.firstElementChild?.setAttribute(key, raw) : undefined,
      }),
    );
    this.body.replaceChildren(...fields);
  }

  renderPage(frontmatter) {
    this.heading.textContent = '页面属性';
    const page = readPage(frontmatter);
    if (page.errors) {
      this.body.replaceChildren(
        ...page.errors.map((text) => {
          const message = document.createElement('p');
          message.className = 'bake-field-error';
          message.textContent = text;
          return message;
        }),
      );
      return;
    }
    const entries = pageEntries(page.values, this.site);
    const fieldOf = (entry) =>
      field({
        key: entry.name,
        definition: entry.control,
        value: entry.value,
        error: entry.error,
        commit: (raw) => writePageField(this.view, this.site, entry, raw),
      });
    const children = entries.common.map(fieldOf);
    if (entries.layout.length > 0) {
      const title = document.createElement('h3');
      title.textContent = '版式字段';
      children.push(title, ...entries.layout.map(fieldOf));
    }
    this.body.replaceChildren(...children);
  }

  destroy() {
    window.removeEventListener('bake:page-updated', this.restoreClass);
    document.body.classList.remove('properties-open');
    this.element.remove();
  }
}

export function properties(registry) {
  const definitions = attributeDefinitions(registry);
  return [
    $prose(() => propertiesState(definitions)),
    $prose(() => new Plugin({ view: (view) => new PanelView(view, definitions, registry) })),
    pageChrome,
  ];
}
