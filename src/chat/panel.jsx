import { For, Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import { render } from 'solid-js/web';
import { selectionMarkdown } from '../copy/copy.js';
import styles from './panel.css?inline';
import { READ_ARTICLE, articlePrompt, blogPrompt, blogTools, currentPage, loadCatalog, readArticle } from './context.js';
import { answer } from './conversation.js';
import { ApiError, checkKey } from './deepseek.js';
import { createFigure } from './figure.js';
import { MATH_CLASS, replyHtml } from './reply.js';
import { VaultError, clearKey, saveKey, storedKey, unlockKey } from './vault.js';

const THINKING_KEY = 'bk-chat-thinking';
const COPIED_TIME = 1200;
const NEAR_BOTTOM = 48;
const CONTEXT_LENGTH = /context length/i;
const typeset = new Map();

export function createPanel({ shadow, root, labels, launcher }) {
  const style = document.createElement('style');
  style.textContent = styles;
  const mount = document.createElement('div');
  shadow.append(style, mount);
  let controls;
  render(() => <Panel root={root} labels={labels} launcher={launcher} ref={(value) => (controls = value)} />, mount);
  return controls;
}

function Panel(props) {
  const { root, labels, launcher } = props;
  let page = currentPage(root);
  const figure = createFigure();
  const [open, setOpen] = createSignal(false);
  const [view, setView] = createSignal(storedKey() === null ? 'setup' : 'locked');
  const [mode, setMode] = createSignal(page.article === null ? 'blog' : 'article');
  const [messages, setMessages] = createStore([]);
  const [quote, setQuote] = createSignal(null);
  const [busy, setBusy] = createSignal(false);
  const [pending, setPending] = createSignal(null);
  const [problem, setProblem] = createSignal(null);
  const [menu, setMenu] = createSignal(false);
  const [thinking, setThinking] = createSignal(readThinking());
  const [draft, setDraft] = createSignal('');
  let apiKey = null;
  let history = [];
  let abort = null;
  let generation = 0;
  let panel;
  let input;
  let list;
  let unlockTried = false;

  const focusInput = () => requestAnimationFrame(() => (view() === 'chat' ? input : panel.querySelector('input, button.bk-chat-primary'))?.focus());

  const show = () => {
    setOpen(true);
    launcher.toggleAttribute('data-hidden', true);
    focusInput();
    if (view() === 'locked' && !unlockTried) unlock();
  };
  const hide = () => {
    setOpen(false);
    setMenu(false);
    launcher.toggleAttribute('data-hidden', false);
    launcher.focus();
  };

  async function unlock() {
    unlockTried = true;
    setPending('unlock');
    setProblem(null);
    try {
      apiKey = await unlockKey();
      setView('chat');
      focusInput();
    } catch (error) {
      setProblem(vaultProblem(error, labels));
    } finally {
      setPending(null);
    }
  }

  async function save(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const key = String(new FormData(form).get('key')).trim();
    if (key === '') return;
    setProblem(null);
    try {
      setPending('check');
      await checkKey(key);
      setPending('save');
      await saveKey(key, { site: location.hostname });
      apiKey = key;
      form.reset();
      setView('chat');
      focusInput();
    } catch (error) {
      setProblem(error instanceof VaultError ? vaultProblem(error, labels) : requestProblem(error, labels));
    } finally {
      setPending(null);
    }
  }

  const forget = () => {
    abort?.abort();
    clearKey();
    apiKey = null;
    unlockTried = false;
    newChat();
    setView('setup');
    setMenu(false);
    focusInput();
  };
  const changeKey = () => {
    setProblem(null);
    setView('setup');
    setMenu(false);
    focusInput();
  };
  function newChat() {
    generation += 1;
    abort?.abort();
    setBusy(false);
    history = [];
    setMessages([]);
    setQuote(null);
    setMenu(false);
    figure.setState('idle');
  }

  function send(event) {
    event?.preventDefault();
    const text = draft().trim();
    if (text === '' || busy()) return;
    const quoted = quote();
    const content = quoted === null ? text : `${quoted.replace(/^/gm, '> ')}\n\n${text}`;
    setMessages(messages.length, { role: 'user', text, quote: quoted });
    setDraft('');
    setQuote(null);
    run(content);
  }

  async function run(content) {
    const index = messages.length;
    const chat = generation;
    setMessages(index, { role: 'assistant', content: '', reasoning: '', reads: [], error: null, done: false });
    history.push({ role: 'user', content });
    setBusy(true);
    figure.setState('waiting');
    const controller = new AbortController();
    abort = controller;
    let latest = null;
    let frame = 0;
    const commit = () => {
      frame = 0;
      if (chat !== generation) return;
      setMessages(index, { content: latest.content, reasoning: latest.reasoning, reads: latest.reads });
      if (latest.content !== '') figure.setState('answering');
    };
    let failure = null;
    try {
      const blog = mode() === 'blog';
      const catalog = blog ? await loadCatalog(root).catch(() => Promise.reject(new CatalogError())) : null;
      const { added } = await answer({
        key: apiKey,
        system: blog ? blogPrompt(page, catalog) : articlePrompt(page),
        history,
        tools: blog ? blogTools : [],
        runTool: (name, args) => (name === READ_ARTICLE ? readArticle(root, catalog, args.address) : Promise.resolve({ content: `Unknown tool ${name}`, label: name, failed: true })),
        thinking: thinking(),
        signal: controller.signal,
        onUpdate: (turn) => {
          latest = turn;
          frame ||= requestAnimationFrame(commit);
        },
      });
      if (chat === generation) history.push(...added);
    } catch (error) {
      failure = controller.signal.aborted ? null : error;
      if (chat === generation) {
        if (failure === null && latest !== null && latest.content !== '') history.push({ role: 'assistant', content: latest.content, reasoning_content: latest.reasoning });
        else history.pop();
      }
    }
    cancelAnimationFrame(frame);
    if (abort === controller) abort = null;
    if (chat !== generation) return;
    if (latest !== null) commit();
    if (failure !== null) setMessages(index, 'error', requestProblem(failure, labels));
    setMessages(index, 'done', true);
    figure.setState(failure === null ? 'idle' : 'failed');
    setBusy(false);
  }

  const retryable = (index) => !busy() && index === messages.length - 1;

  const retry = (index) => {
    if (!retryable(index)) return;
    const asked = messages[index - 1];
    setMessages(produce((list) => list.splice(index, 1)));
    run(asked.quote === null ? asked.text : `${asked.quote.replace(/^/gm, '> ')}\n\n${asked.text}`);
  };

  const ask = (range) => {
    const article = page.article?.element;
    const selected = article === null || article === undefined ? null : selectionMarkdown(range, article);
    if (selected !== null) {
      setQuote(selected.markdown);
      setMode('article');
    }
    show();
  };

  const toggleThinking = () => {
    const next = !thinking();
    setThinking(next);
    try {
      if (next) localStorage.setItem(THINKING_KEY, 'on');
      else localStorage.removeItem(THINKING_KEY);
    } catch {}
  };

  props.ref({ open: show, ask });

  createEffect(() => {
    messages.length;
    const last = messages[messages.length - 1];
    last?.content;
    last?.reads?.length;
    if (list === undefined) return;
    if (list.scrollHeight - list.scrollTop - list.clientHeight < NEAR_BOTTOM + 200) list.scrollTop = list.scrollHeight;
  });

  const keydown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (menu()) setMenu(false);
      else hide();
    }
  };
  const outside = (event) => {
    if (menu() && !event.composedPath().some((element) => element instanceof Element && element.classList.contains('bk-chat-menu-area'))) setMenu(false);
  };
  const refresh = () => (page = currentPage(root));
  document.addEventListener('pointerdown', outside);
  document.addEventListener('bake:content', refresh);
  onCleanup(() => {
    document.removeEventListener('pointerdown', outside);
    document.removeEventListener('bake:content', refresh);
  });

  return (
    <section class="bk-chat-panel" classList={{ 'is-open': open() }} role="dialog" aria-label={labels.title} aria-hidden={String(!open())} ref={panel} onKeyDown={keydown}>
      <header class="bk-chat-header">
        {figure.element}
        <span class="bk-chat-title">{labels.title}</span>
        <Show when={page.article !== null && view() === 'chat'}>
          <div class="bk-chat-modes" role="group" aria-label={labels.modeLabel}>
            <For each={['article', 'blog']}>
              {(value) => (
                <button type="button" data-mode={value} aria-pressed={String(mode() === value)} onClick={() => setMode(value)}>
                  {labels.modes[value]}
                </button>
              )}
            </For>
          </div>
        </Show>
        <span class="bk-chat-grow" />
        <Show when={view() === 'chat'}>
          <div class="bk-chat-menu-area">
            <button type="button" class="bk-chat-icon" aria-label={labels.menu} aria-expanded={String(menu())} onClick={() => setMenu(!menu())}>
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="3.5" cy="8" r="1.3" />
                <circle cx="8" cy="8" r="1.3" />
                <circle cx="12.5" cy="8" r="1.3" />
              </svg>
            </button>
            <div class="bk-chat-menu" classList={{ 'is-open': menu() }} role="menu">
              <button type="button" role="menuitem" onClick={newChat}>
                {labels.newChat}
              </button>
              <button type="button" role="menuitem" onClick={changeKey}>
                {labels.changeKey}
              </button>
              <button type="button" role="menuitem" data-action="clear-key" onClick={forget}>
                {labels.clearKey}
              </button>
            </div>
          </div>
        </Show>
        <button type="button" class="bk-chat-icon" aria-label={labels.close} onClick={hide}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </header>
      <Show when={view() === 'setup'}>
        <form class="bk-chat-view bk-chat-setup" onSubmit={save}>
          <h2>{labels.setupTitle}</h2>
          <p>{labels.setupText}</p>
          <p>
            <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener noreferrer">
              {labels.setupLink}
            </a>
          </p>
          <label>
            <span>{labels.keyLabel}</span>
            <input name="key" type="password" autocomplete="off" spellcheck={false} placeholder="sk-…" disabled={pending() !== null} />
          </label>
          <Show when={problem() !== null}>
            <p class="bk-chat-problem" role="alert">
              {problem()}
            </p>
          </Show>
          <div class="bk-chat-actions">
            <Show when={storedKey() !== null}>
              <button type="button" class="bk-chat-secondary" onClick={() => setView(apiKey === null ? 'locked' : 'chat')}>
                {labels.close}
              </button>
            </Show>
            <button type="submit" class="bk-chat-primary" disabled={pending() !== null}>
              {pending() === 'check' ? labels.checking : pending() === 'save' ? labels.saving : labels.save}
            </button>
          </div>
        </form>
      </Show>
      <Show when={view() === 'locked'}>
        <div class="bk-chat-view bk-chat-setup">
          <h2>{labels.lockedTitle}</h2>
          <p>{labels.lockedText}</p>
          <Show when={problem() !== null}>
            <p class="bk-chat-problem" role="alert">
              {problem()}
            </p>
          </Show>
          <div class="bk-chat-actions">
            <button type="button" class="bk-chat-secondary" onClick={forget}>
              {labels.clearKey}
            </button>
            <button type="button" class="bk-chat-primary" disabled={pending() !== null} onClick={unlock}>
              {pending() === 'unlock' ? labels.unlocking : labels.unlock}
            </button>
          </div>
        </div>
      </Show>
      <Show when={view() === 'chat'}>
        <div class="bk-chat-view bk-chat-conversation">
          <div class="bk-chat-messages" ref={list} aria-live="polite">
            <Show when={messages.length === 0}>
              <p class="bk-chat-empty">{labels.empty[mode()]}</p>
            </Show>
            <For each={messages}>{(message, index) => (message.role === 'user' ? <UserMessage message={message} labels={labels} /> : <Reply message={message} root={root} labels={labels} canRetry={retryable(index())} onRetry={() => retry(index())} />)}</For>
          </div>
          <form class="bk-chat-composer" onSubmit={send}>
            <Show when={quote() !== null}>
              <div class="bk-chat-quote">
                <span class="bk-chat-quote-text">{quote()}</span>
                <button type="button" class="bk-chat-icon" aria-label={labels.removeQuote} onClick={() => setQuote(null)}>
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M5 5l6 6M11 5l-6 6" />
                  </svg>
                </button>
              </div>
            </Show>
            <textarea
              ref={input}
              rows="1"
              value={draft()}
              placeholder={labels.placeholder[mode()]}
              aria-label={labels.placeholder[mode()]}
              onInput={(event) => {
                setDraft(event.currentTarget.value);
                grow(event.currentTarget);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) send(event);
              }}
            />
            <div class="bk-chat-tools">
              <button type="button" class="bk-chat-toggle" aria-pressed={String(thinking())} onClick={toggleThinking}>
                {labels.thinking}
              </button>
              <span class="bk-chat-grow" />
              <Show
                when={busy()}
                fallback={
                  <button type="submit" class="bk-chat-send" disabled={draft().trim() === ''}>
                    {labels.send}
                  </button>
                }
              >
                <button type="button" class="bk-chat-send" data-action="stop" onClick={() => abort?.abort()}>
                  {labels.stop}
                </button>
              </Show>
            </div>
          </form>
        </div>
      </Show>
    </section>
  );
}

function UserMessage(props) {
  return (
    <div class="bk-chat-user">
      <Show when={props.message.quote !== null}>
        <blockquote>{props.message.quote}</blockquote>
      </Show>
      <p>{props.message.text}</p>
    </div>
  );
}

function Reply(props) {
  const { labels, root } = props;
  const [copied, setCopied] = createSignal(false);
  let body;
  createEffect(() => {
    body.innerHTML = replyHtml(props.message.content, { root });
    typesetMath(body);
  });
  const copy = () =>
    navigator.clipboard?.writeText(props.message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_TIME);
    });
  return (
    <div class="bk-chat-reply" data-done={props.message.done ? '' : undefined}>
      <Show when={props.message.reasoning !== ''}>
        <details class="bk-chat-reasoning">
          <summary>{labels.reasoning}</summary>
          <p>{props.message.reasoning}</p>
        </details>
      </Show>
      <For each={props.message.reads}>
        {(read) => (
          <p class="bk-chat-read" data-failed={read.failed ? '' : undefined}>
            {read.done ? (read.failed ? labels.readFailed(read.label) : labels.read(read.label)) : labels.reading(read.label ?? '…')}
          </p>
        )}
      </For>
      <div class="bk-chat-answer" ref={body} />
      <Show when={props.message.error !== null}>
        <p class="bk-chat-problem" role="alert">
          {props.message.error}
          <Show when={props.canRetry}>
            {' '}
            <button type="button" class="bk-chat-link" onClick={props.onRetry}>
              {labels.retry}
            </button>
          </Show>
        </p>
      </Show>
      <Show when={props.message.done && props.message.content !== ''}>
        <div class="bk-chat-reply-tools">
          <button type="button" class="bk-chat-link" onClick={copy}>
            {copied() ? labels.replyCopied : labels.copyReply}
          </button>
        </div>
      </Show>
    </div>
  );
}

function typesetMath(container) {
  for (const element of container.querySelectorAll(`.${MATH_CLASS}`)) {
    const display = element.dataset.display === 'true';
    const key = `${display ? 'display' : 'inline'} ${element.dataset.tex}`;
    const done = typeset.get(key);
    if (typeof done === 'string') {
      element.innerHTML = done;
      element.dataset.state = 'ready';
    } else if (done === null) {
      element.dataset.state = 'failed';
    } else if (done === undefined) {
      typeset.set(
        key,
        import('bake/math')
          .then(({ texToSvg }) => texToSvg(element.dataset.tex, { display }))
          .then(
            (svg) => typeset.set(key, svg.outerHTML),
            () => typeset.set(key, null),
          )
          .then(() => container.isConnected && typesetMath(container)),
      );
    }
  }
}

function grow(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${textarea.scrollHeight}px`;
}

function readThinking() {
  try {
    return localStorage.getItem(THINKING_KEY) === 'on';
  } catch {
    return false;
  }
}

function vaultProblem(error, labels) {
  return labels.errors[error instanceof VaultError ? error.reason : 'failed'] ?? labels.errors.failed;
}

class CatalogError extends Error {}

function requestProblem(error, labels) {
  if (error instanceof CatalogError) return labels.errors.catalog;
  if (error instanceof TypeError) return labels.errors.network;
  if (!(error instanceof ApiError)) return labels.errors.other(error.message);
  if (error.status === 401) return labels.errors.invalidKey;
  if (error.status === 402) return labels.errors.balance;
  if (error.status === 429) return labels.errors.rate;
  if (error.status === 400 && CONTEXT_LENGTH.test(error.message)) return labels.errors.tooLong;
  if (error.status >= 500) return labels.errors.server;
  return labels.errors.other(error.message);
}
