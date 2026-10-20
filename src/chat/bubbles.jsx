import { For, Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import { render } from 'solid-js/web';
import { selectionMarkdown } from '../copy/copy.js';
import styles from './bubbles.css?inline';
import { READ_ARTICLE, chatTools, currentPage, loadCatalog, matchingScopes, readArticle, scopeOptions, systemPrompt } from './context.js';
import { answer } from './conversation.js';
import { ApiError, checkKey } from './deepseek.js';
import { PetError, chooseReaderPet, forgetReaderPet, storedReaderPet } from './reader-pet.js';
import { MATH_CLASS, replyHtml } from './reply.js';
import { VaultError, clearKey, saveKey, storedKey, unlockKey } from './vault.js';

const THINKING_KEY = 'bk-chat-thinking';
const SCOPE_QUERY = /@([^\s@]*)$/;
const CONTEXT_LENGTH = /context length/i;
const DEEPSEEK_KEYS = 'https://platform.deepseek.com/api_keys';
const typeset = new Map();

export function createChat({ shadow, root, labels, pet, petSource, launcher }) {
  const style = document.createElement('style');
  style.textContent = styles;
  const mount = document.createElement('div');
  shadow.append(style, mount);
  let controls;
  render(() => <Chat root={root} labels={labels} pet={pet} petSource={petSource} launcher={launcher} ref={(value) => (controls = value)} />, mount);
  return controls;
}

function Chat(props) {
  const { root, labels, pet, launcher } = props;
  let page = currentPage(root);
  const [open, setOpen] = createSignal(false);
  const [view, setView] = createSignal(storedKey() === null ? 'setup' : 'locked');
  const [messages, setMessages] = createStore([]);
  const [scopes, setScopes] = createSignal([]);
  const [options, setOptions] = createSignal(null);
  const [query, setQuery] = createSignal(null);
  const [active, setActive] = createSignal(0);
  const [quote, setQuote] = createSignal(null);
  const [draft, setDraft] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [pending, setPending] = createSignal(null);
  const [menu, setMenu] = createSignal(false);
  const [thinking, setThinking] = createSignal(readThinking());
  const [faded, setFaded] = createSignal(false);
  let apiKey = null;
  let abort = null;
  let lastId = 0;
  let unlockTried = false;
  let activity = 'idle';
  let container;
  let list;
  let input;

  const setPet = (state) => {
    activity = state;
    if (open()) pet.setState(state);
  };
  const add = (message) => {
    lastId += 1;
    setMessages(messages.length, { id: lastId, ...message });
    return lastId;
  };
  const update = (id, patch) => setMessages((message) => message.id === id, patch);
  const remove = (id) =>
    setMessages(
      produce((all) =>
        all.splice(
          all.findIndex((message) => message.id === id),
          1,
        ),
      ),
    );
  const present = (id) => messages.some((message) => message.id === id);
  const note = (text, extra = {}) => add({ role: 'note', text, ...extra });
  const problem = (text, retry = null) => add({ role: 'problem', text, retry });
  const conversation = () =>
    messages.flatMap((message) =>
      message.role === 'assistant' && message.done && message.error === null && message.sent.length > 0 ? [{ role: 'user', content: message.ask.content }, ...message.sent] : [],
    );
  const focusInput = () => requestAnimationFrame(() => open() && input?.focus({ preventScroll: true }));

  const show = () => {
    if (open()) return;
    pet.load();
    setOpen(true);
    launcher.setAttribute('aria-expanded', 'true');
    if (messages.length === 0) greet();
    pet.setState(busy() || pending() !== null ? activity : 'open');
    focusInput();
    if (view() === 'locked' && !unlockTried) unlock();
  };
  const hide = ({ focus = true } = {}) => {
    if (!open()) return;
    setOpen(false);
    setMenu(false);
    setQuery(null);
    launcher.setAttribute('aria-expanded', 'false');
    pet.setState('idle');
    if (focus) launcher.focus({ preventScroll: true });
  };
  const toggle = () => (open() ? hide() : show());

  function greet() {
    if (view() === 'setup') note(labels.setupText, { link: { href: DEEPSEEK_KEYS, text: labels.setupLink } });
    else note(labels.greeting[page.article === null ? 'blog' : 'article']);
  }

  async function unlock() {
    unlockTried = true;
    setPending('unlock');
    setPet('unlocking');
    note(labels.unlocking);
    try {
      apiKey = await unlockKey();
      setView('chat');
      note(labels.unlocked);
      setPet('idle');
      return true;
    } catch (error) {
      setPet('failed');
      problem(vaultProblem(error, labels), 'unlock');
      return false;
    } finally {
      setPending(null);
      focusInput();
    }
  }

  async function saveApiKey(key) {
    setDraft('');
    setPending('save');
    setPet('unlocking');
    try {
      note(labels.checking);
      await checkKey(key);
      note(labels.saving);
      await saveKey(key, { site: location.hostname });
      apiKey = key;
      setView('chat');
      note(labels.saved);
      setPet('answered');
    } catch (error) {
      setPet('failed');
      problem(error instanceof VaultError ? vaultProblem(error, labels) : requestProblem(error, labels));
    } finally {
      setPending(null);
      focusInput();
    }
  }

  const newChat = () => {
    abort?.abort();
    setBusy(false);
    setMessages([]);
    setQuote(null);
    setScopes([]);
    setMenu(false);
    setPet('idle');
    greet();
    focusInput();
  };
  const changeKey = () => {
    setMenu(false);
    setView('setup');
    note(labels.setupText, { link: { href: DEEPSEEK_KEYS, text: labels.setupLink } });
    focusInput();
  };
  const forget = () => {
    abort?.abort();
    clearKey();
    apiKey = null;
    unlockTried = false;
    setBusy(false);
    setMessages([]);
    setMenu(false);
    setView('setup');
    note(labels.cleared);
    greet();
    setPet('idle');
    focusInput();
  };

  async function submit(event) {
    event?.preventDefault();
    const text = draft().trim();
    if (text === '' || busy() || pending() !== null) return;
    if (view() === 'setup') return saveApiKey(text);
    if (view() === 'locked' && !(await unlock())) return;
    const picked = scopes();
    const quoted = quote();
    add({ role: 'user', text, quote: quoted, scopes: picked.map((scope) => scope.label) });
    setDraft('');
    setQuote(null);
    setScopes([]);
    run({ content: quoted === null ? text : `${quoted.replace(/^/gm, '> ')}\n\n${text}`, scopes: picked });
  }

  async function run(ask) {
    const { content, scopes: picked } = ask;
    const history = [...conversation(), { role: 'user', content }];
    const id = add({ role: 'assistant', content: '', reasoning: '', reads: [], error: null, done: false, ask, sent: [] });
    setBusy(true);
    setPet(picked.some((scope) => scope.kind !== 'article') ? 'reading' : 'answering');
    const controller = new AbortController();
    abort = controller;
    let latest = null;
    let frame = 0;
    const commit = () => {
      frame = 0;
      if (!present(id)) return;
      update(id, { content: latest.content, reasoning: latest.reasoning, reads: latest.reads });
      const state = latest.reads.some((read) => !read.done) ? 'reading' : 'answering';
      if (activity !== state) setPet(state);
    };
    let failure = null;
    let sent = [];
    try {
      const catalog = await loadCatalog(root).catch(() => Promise.reject(new CatalogError()));
      const articles = picked.filter((scope) => scope.kind === 'article');
      const sources = await Promise.all(
        articles.map(async (scope) => {
          const read = await readArticle(root, catalog, `/${scope.urls[0]}`);
          return { url: scope.urls[0], title: scope.label, content: read.content };
        }),
      );
      const { added } = await answer({
        key: apiKey,
        system: systemPrompt({ page, catalog, scopes: picked, sources }),
        history,
        tools: chatTools,
        runTool: (name, args) => (name === READ_ARTICLE ? readArticle(root, catalog, args.address) : Promise.resolve({ content: `Unknown tool ${name}`, label: name, failed: true })),
        thinking: thinking(),
        signal: controller.signal,
        onUpdate: (turn) => {
          latest = turn;
          frame ||= requestAnimationFrame(commit);
        },
      });
      sent = added;
    } catch (error) {
      failure = controller.signal.aborted ? null : error;
      if (failure === null && latest !== null && latest.content !== '') sent = [{ role: 'assistant', content: latest.content, reasoning_content: latest.reasoning }];
    }
    cancelAnimationFrame(frame);
    if (abort === controller) abort = null;
    if (!present(id)) return;
    if (latest !== null) commit();
    update(id, { sent, error: failure === null ? null : requestProblem(failure, labels), done: true });
    setPet(failure !== null ? 'failed' : controller.signal.aborted ? 'idle' : 'answered');
    setBusy(false);
  }

  const retryable = (id) => !busy() && pending() === null && messages.at(-1)?.id === id;
  const retry = (id) => {
    if (!retryable(id)) return;
    const { ask } = messages.at(-1);
    remove(id);
    run(ask);
  };
  const retryProblem = (id) => {
    if (!retryable(id)) return;
    remove(id);
    unlock();
  };

  const ask = (range) => {
    const article = page.article?.element;
    const selected = article === null || article === undefined ? null : selectionMarkdown(range, article);
    if (selected !== null) setQuote(selected.markdown);
    show();
  };

  const readQuery = () => {
    if (input === undefined || view() === 'setup') return setQuery(null);
    const match = input.value.slice(0, input.selectionStart ?? input.value.length).match(SCOPE_QUERY);
    setQuery(match === null ? null : match[1]);
    if (match !== null && options() === null) {
      loadCatalog(root).then(
        (catalog) => setOptions(scopeOptions(catalog, labels)),
        () => setOptions([]),
      );
    }
  };
  const visibleScopes = () => (query() === null || options() === null ? [] : matchingScopes(options(), query(), scopes()));
  const pick = (scope) => {
    const caret = input.selectionStart ?? input.value.length;
    const start = input.value.slice(0, caret).lastIndexOf('@');
    const value = input.value.slice(0, start) + input.value.slice(caret);
    setDraft(value);
    input.value = value;
    input.setSelectionRange(start, start);
    setScopes([...scopes(), scope]);
    setActive(0);
    readQuery();
  };
  const removeScope = (scope) => {
    setScopes(scopes().filter((item) => item.id !== scope.id));
    input.focus();
  };

  const keydown = (event) => {
    const shown = visibleScopes();
    if (query() !== null && shown.length > 0) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((active() + (event.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length);
        return;
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && !event.isComposing) {
        event.preventDefault();
        pick(shown[Math.min(active(), shown.length - 1)]);
        return;
      }
    }
    if (event.key === 'Escape' && query() !== null) {
      event.preventDefault();
      event.stopPropagation();
      setQuery(null);
      return;
    }
    if (event.key === 'Backspace' && input.selectionStart === 0 && input.selectionEnd === 0) {
      if (scopes().length > 0) setScopes(scopes().slice(0, -1));
      else if (quote() !== null) setQuote(null);
    }
    if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) submit(event);
  };
  const containerKeydown = (event) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    if (menu()) {
      setMenu(false);
      focusInput();
    } else hide();
  };

  const toggleThinking = () => {
    const next = !thinking();
    setThinking(next);
    try {
      if (next) localStorage.setItem(THINKING_KEY, 'on');
      else localStorage.removeItem(THINKING_KEY);
    } catch {}
  };

  const outside = (event) => {
    if (!open()) return;
    const path = event.composedPath();
    if (path.includes(container) || path.includes(launcher)) {
      if (menu() && !path.some((element) => element instanceof Element && element.classList.contains('bk-chat-menu-area'))) setMenu(false);
      return;
    }
    hide({ focus: false });
  };
  const escape = (event) => {
    if (event.key === 'Escape' && open() && !event.defaultPrevented) hide();
  };
  const refresh = () => (page = currentPage(root));
  document.addEventListener('pointerdown', outside);
  document.addEventListener('keydown', escape);
  document.addEventListener('bake:content', refresh);
  onCleanup(() => {
    document.removeEventListener('pointerdown', outside);
    document.removeEventListener('keydown', escape);
    document.removeEventListener('bake:content', refresh);
  });

  props.ref({ open: show, toggle, ask });

  const updateFade = () => {
    const fade = list.scrollHeight - list.clientHeight + list.scrollTop > 2;
    if (faded() !== fade) setFaded(fade);
  };
  createEffect(() => {
    if (messages.length > 0 && list !== undefined) list.scrollTop = 0;
  });
  const resize = new ResizeObserver(() => list && updateFade());
  onCleanup(() => resize.disconnect());

  const placeholder = () => (view() === 'setup' ? labels.placeholder.key : scopes().length > 0 ? labels.placeholder.scoped : labels.placeholder[page.article === null ? 'blog' : 'article']);

  return (
    <section class="bk-chat" data-open={open() ? '' : undefined} role="dialog" aria-label={labels.title} aria-hidden={String(!open())} ref={container} onKeyDown={containerKeydown}>
      <div class="bk-chat-bubbles" data-faded={faded() ? '' : undefined} ref={list} aria-live="polite" onScroll={updateFade}>
        <div class="bk-chat-thread" ref={(element) => resize.observe(element)}>
          <For each={messages}>
            {(message) =>
              message.role === 'user' ? (
                <UserBubble message={message} />
              ) : message.role === 'assistant' ? (
                <Reply message={message} root={root} labels={labels} canRetry={retryable(message.id)} onRetry={() => retry(message.id)} />
              ) : message.role === 'problem' ? (
                <p class="bk-chat-bubble bk-chat-problem" role="alert">
                  {message.text}
                  <Show when={message.retry !== null && retryable(message.id)}>
                    {' '}
                    <button type="button" class="bk-chat-link" onClick={() => retryProblem(message.id)}>
                      {labels.retry}
                    </button>
                  </Show>
                </p>
              ) : (
                <p class="bk-chat-bubble bk-chat-note">
                  {message.text}
                  <Show when={message.link}>
                    {' '}
                    <a href={message.link.href} target="_blank" rel="noopener noreferrer">
                      {message.link.text}
                    </a>
                  </Show>
                </p>
              )
            }
          </For>
        </div>
      </div>
      <form class="bk-chat-composer" onSubmit={submit}>
        <Show when={query() !== null && options() !== null}>
          <div class="bk-chat-scopes" role="listbox" aria-label={labels.scopes}>
            <Show when={visibleScopes().length > 0} fallback={<p class="bk-chat-scopes-none">{labels.noScope}</p>}>
              <For each={visibleScopes()}>
                {(scope, index) => (
                  <>
                    <Show when={index() === 0 || visibleScopes()[index() - 1].kind !== scope.kind}>
                      <p class="bk-chat-scopes-group">{labels.kinds[scope.kind]}</p>
                    </Show>
                    <div
                      class="bk-chat-scope"
                      role="option"
                      aria-selected={String(index() === Math.min(active(), visibleScopes().length - 1))}
                      ref={(element) => createEffect(() => index() === active() && element.scrollIntoView({ block: 'nearest' }))}
                      onPointerDown={(event) => {
                        event.preventDefault();
                        pick(scope);
                      }}
                    >
                      <span>{scope.label}</span>
                      <small>{scope.meta}</small>
                    </div>
                  </>
                )}
              </For>
            </Show>
          </div>
        </Show>
        <Show when={quote() !== null}>
          <span class="bk-chat-chip bk-chat-quote" title={quote()}>
            <span>
              {labels.quote}：{quote()}
            </span>
            <button type="button" aria-label={labels.removeQuote} onClick={() => setQuote(null)}>
              ✕
            </button>
          </span>
        </Show>
        <For each={scopes()}>
          {(scope) => (
            <span class="bk-chat-chip">
              <span>@{scope.label}</span>
              <button type="button" aria-label={labels.removeScope(scope.label)} onClick={() => removeScope(scope)}>
                ✕
              </button>
            </span>
          )}
        </For>
        <input
          ref={input}
          type={view() === 'setup' ? 'password' : 'text'}
          name={view() === 'setup' ? 'key' : 'question'}
          autocomplete="off"
          spellcheck={view() !== 'setup'}
          value={draft()}
          placeholder={placeholder()}
          aria-label={view() === 'setup' ? labels.placeholder.key : labels.question}
          onInput={(event) => {
            setDraft(event.currentTarget.value);
            setActive(0);
            readQuery();
          }}
          onClick={readQuery}
          onBlur={() => setQuery(null)}
          onKeyDown={keydown}
        />
        <div class="bk-chat-menu-area">
          <button type="button" class="bk-chat-icon" aria-label={labels.settings} aria-expanded={String(menu())} onClick={() => setMenu(!menu())}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="3.5" cy="8" r="1.3" />
              <circle cx="8" cy="8" r="1.3" />
              <circle cx="12.5" cy="8" r="1.3" />
            </svg>
          </button>
          <Show when={menu()}>
            <Settings
              labels={labels}
              root={root}
              pet={pet}
              petSource={props.petSource}
              view={view()}
              thinking={thinking()}
              onNewChat={newChat}
              onThinking={toggleThinking}
              onChangeKey={changeKey}
              onClearKey={forget}
            />
          </Show>
        </div>
        <Show
          when={busy()}
          fallback={
            <button type="submit" class="bk-chat-send" disabled={draft().trim() === '' || pending() !== null}>
              {view() === 'setup' ? labels.save : labels.send}
            </button>
          }
        >
          <button type="button" class="bk-chat-send" data-action="stop" onClick={() => abort?.abort()}>
            {labels.stop}
          </button>
        </Show>
      </form>
    </section>
  );
}

function Settings(props) {
  const { labels, root, pet } = props;
  const [address, setAddress] = createSignal(storedReaderPet()?.url ?? '');
  const [status, setStatus] = createSignal(null);
  const [loading, setLoading] = createSignal(false);
  const [chosen, setChosen] = createSignal(storedReaderPet() !== null);
  const [site, setSite] = createSignal(null);
  fetch(new URL('_bake/pet/pet.json', root))
    .then((response) => (response.ok ? response.json() : null))
    .then(setSite, () => setSite(null));

  const use = async (event) => {
    event.preventDefault();
    if (loading()) return;
    setLoading(true);
    setStatus({ text: labels.petLoading });
    try {
      const chosenPet = await chooseReaderPet(address().trim());
      pet.setSource(props.petSource());
      setChosen(true);
      setStatus({ text: labels.petChosen(chosenPet.name) });
    } catch (error) {
      const message = error instanceof PetError ? labels.petErrors[error.code] : labels.petErrors.network;
      setStatus({ text: typeof message === 'function' ? message(error.detail) : message, failed: true });
    } finally {
      setLoading(false);
    }
  };
  const reset = () => {
    forgetReaderPet();
    pet.setSource(props.petSource());
    setChosen(false);
    setAddress('');
    setStatus(null);
  };

  return (
    <div class="bk-chat-menu" role="group" aria-label={labels.settings}>
      <button type="button" class="bk-chat-menu-item" onClick={props.onNewChat}>
        {labels.newChat}
      </button>
      <button type="button" class="bk-chat-menu-item" aria-pressed={String(props.thinking)} onClick={props.onThinking}>
        {labels.thinking}
      </button>
      <Show when={props.view !== 'setup'}>
        <button type="button" class="bk-chat-menu-item" onClick={props.onChangeKey}>
          {labels.changeKey}
        </button>
      </Show>
      <Show when={storedKey() !== null}>
        <button type="button" class="bk-chat-menu-item" data-action="clear-key" onClick={props.onClearKey}>
          {labels.clearKey}
        </button>
      </Show>
      <form class="bk-chat-pet-form" onSubmit={use}>
        <label>
          <span>{labels.pet}</span>
          <input type="url" name="pet" value={address()} placeholder={labels.petAddress} aria-label={labels.petAddress} spellcheck={false} onInput={(event) => setAddress(event.currentTarget.value)} />
        </label>
        <button type="submit" class="bk-chat-menu-button" disabled={loading() || address().trim() === ''}>
          {labels.petUse}
        </button>
      </form>
      <Show when={status() !== null}>
        <p class="bk-chat-pet-status" data-failed={status().failed ? '' : undefined} role={status().failed ? 'alert' : undefined}>
          {status().text}
        </p>
      </Show>
      <Show when={chosen()}>
        <button type="button" class="bk-chat-link" onClick={reset}>
          {labels.petReset}
        </button>
      </Show>
      <Show when={!chosen() && site()?.credit}>
        <p class="bk-chat-credit">
          <a href={new URL(site().credit.href, new URL('_bake/pet/', root)).href} target="_blank" rel="noopener">
            {labels.credit(site().displayName, site().credit)}
          </a>
        </p>
      </Show>
    </div>
  );
}

function UserBubble(props) {
  return (
    <div class="bk-chat-bubble bk-chat-user">
      <Show when={props.message.quote !== null}>
        <blockquote>{props.message.quote}</blockquote>
      </Show>
      <p>
        <For each={props.message.scopes}>{(label) => <span class="bk-chat-chip">@{label}</span>}</For>
        {props.message.text}
      </p>
    </div>
  );
}

function Reply(props) {
  const { labels, root } = props;
  let body;
  createEffect(() => {
    body.innerHTML = replyHtml(props.message.content, { root });
    typesetMath(body);
  });
  return (
    <div class="bk-chat-bubble bk-chat-reply" data-done={props.message.done ? '' : undefined}>
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
