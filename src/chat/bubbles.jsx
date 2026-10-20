import { For, Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import { render } from 'solid-js/web';
import { selectionMarkdown } from '../copy/copy.js';
import styles from './bubbles.css?inline';
import { CHAT_RULES, READ_ARTICLE, articlePage, catalogEntry, chatTools, currentPage, loadCatalog, matchingScopes, readArticle, scopeOptions, systemPrompt } from './context.js';
import { answer } from './conversation.js';
import { ApiError, checkKey, complete } from './deepseek.js';
import { addNoteVersion, deleteConversation, historyGroups, localDate, readHistory, roundMessages, saveConversation, storedRound } from './history.js';
import { HistoryList } from './history-list.jsx';
import { MAX_INSTRUCTIONS, MAX_RULES, customPrompts, readPrompts, savePrompts } from './instructions.js';
import { NoteCard } from './note-card.jsx';
import { MAX_NOTE_SOURCES, checkNote, citedEntries, notePrompt, noteRules } from './note.js';
import { PetError, chooseReaderPet, forgetReaderPet, storedReaderPet } from './reader-pet.js';
import { MATH_CLASS, replyHtml } from './reply.js';
import { typesetMath } from './typeset.js';
import { VaultError, clearKey, rememberedKey, saveKey, storedKey, unlockKey } from './vault.js';

const THINKING_KEY = 'bk-chat-thinking';
const SCOPE_QUERY = /@([^\s@]*)$/;
const CONTEXT_LENGTH = /context length/i;
const DEEPSEEK_KEYS = 'https://platform.deepseek.com/api_keys';
const composing = (event) => event.isComposing || event.keyCode === 229;

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
  const [popover, setPopover] = createSignal(null);
  const [thinking, setThinking] = createSignal(readThinking());
  const [faded, setFaded] = createSignal(false);
  const [announcement, setAnnouncement] = createSignal(null);
  const pageArticle = () => (page.article === null ? null : { address: page.address, title: page.title });
  const [article, setArticle] = createSignal(pageArticle());
  const [studyNote, setStudyNote] = createSignal(null);
  const [noteOpen, setNoteOpen] = createSignal(false);
  const [noteBusy, setNoteBusy] = createSignal(false);
  const [noteHint, setNoteHint] = createSignal('');
  const [redo, setRedo] = createSignal(false);
  const [historyItems, setHistoryItems] = createSignal([]);
  const builtInPrompts = { chat: CHAT_RULES, note: noteRules(labels) };
  const [prompts, setPrompts] = createSignal(readPrompts());
  let conversationId = crypto.randomUUID();
  let awayPage = null;
  let apiKey = null;
  let abort = null;
  let noteAbort = null;
  let historyNew;
  let lastId = 0;
  let unlockTried = false;
  let remembering = null;
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
  const note = (text, extra = {}) => {
    setAnnouncement({ text });
    return add({ role: 'note', text, ...extra });
  };
  const problem = (text, retry = null) => add({ role: 'problem', text, retry });
  const finished = () => messages.filter((message) => message.role === 'assistant' && message.done && message.error === null && message.sent.length > 0);
  const conversation = () => finished().flatMap((message) => [{ role: 'user', content: message.ask.content }, ...message.sent]);
  const away = () => article() !== null && article().address !== page.address;
  const persist = () => {
    const rounds = finished().map(storedRound);
    if (rounds.length > 0) saveConversation(root, { id: conversationId, article: article(), date: localDate(), rounds, note: studyNote() });
  };
  const contextPage = async (catalog) => {
    if (!away()) return page;
    if (awayPage?.article.address !== article().address) awayPage = await articlePage(root, catalog, page, article().address);
    return awayPage;
  };
  const focusInput = () => requestAnimationFrame(() => open() && input?.focus({ preventScroll: true }));

  let closeNoteOnHide = false;
  const show = () => {
    if (open()) return;
    closeNoteOnHide = false;
    pet.load();
    setOpen(true);
    launcher.setAttribute('aria-expanded', 'true');
    if (messages.length === 0) greet();
    pet.setState(busy() || pending() !== null ? activity : 'open');
    focusInput();
    if (!unlockTried) unlockRemembered();
  };
  const hide = ({ focus = true } = {}) => {
    if (!open()) return;
    setOpen(false);
    setPopover(null);
    closeNoteOnHide = noteOpen() || redo();
    setQuery(null);
    launcher.setAttribute('aria-expanded', 'false');
    pet.setState('idle');
    if (focus) launcher.focus({ preventScroll: true });
  };
  const toggle = () => (open() ? hide() : show());
  const hidden = (event) => {
    if (open() || !closeNoteOnHide || event.pseudoElement !== '::before' || event.propertyName !== 'opacity') return;
    closeNoteOnHide = false;
    setNoteOpen(false);
    setRedo(false);
  };

  function greet() {
    if (view() === 'setup') note(labels.setupText, { link: { href: DEEPSEEK_KEYS, text: labels.setupLink } });
    else note(labels.greeting[page.article === null ? 'blog' : 'article']);
  }

  function unlockRemembered() {
    unlockTried = true;
    remembering ??= rememberedKey().then((key) => {
      remembering = null;
      if (key !== null && view() === 'locked') {
        apiKey = key;
        setView('chat');
      }
      return view() === 'chat';
    });
    return remembering;
  }

  async function unlock() {
    setPending('unlock');
    try {
      if (await unlockRemembered()) return true;
      setPet('unlocking');
      note(labels.unlocking);
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

  const reset = () => {
    abort?.abort();
    noteAbort?.abort();
    setBusy(false);
    setNoteBusy(false);
    setMessages([]);
    setQuote(null);
    setScopes([]);
    setPopover(null);
    conversationId = crypto.randomUUID();
    setArticle(pageArticle());
    setStudyNote(null);
    setNoteOpen(false);
    setRedo(false);
    setNoteHint('');
  };
  const newChat = () => {
    reset();
    setPet('idle');
    greet();
    focusInput();
  };
  const restore = (item) => {
    reset();
    conversationId = item.id;
    setArticle(item.article);
    setStudyNote(item.note);
    for (const message of item.rounds.flatMap(roundMessages)) add(message);
    if (away()) note(labels.restoredFrom(item.article.title));
    setPet('idle');
    focusInput();
  };
  const toggleHistory = () => {
    if (popover() === 'history') return setPopover(null);
    setHistoryItems(readHistory(root).filter((item) => item.id !== conversationId));
    setPopover('history');
    requestAnimationFrame(() => historyNew?.focus({ preventScroll: true }));
  };
  const forgetConversation = (item) => {
    deleteConversation(root, item.id);
    setHistoryItems(historyItems().filter((other) => other.id !== item.id));
    historyNew?.focus({ preventScroll: true });
  };
  const changeKey = () => {
    setPopover(null);
    setView('setup');
    note(labels.setupText, { link: { href: DEEPSEEK_KEYS, text: labels.setupLink } });
    focusInput();
  };
  const forget = () => {
    clearKey();
    apiKey = null;
    unlockTried = false;
    reset();
    setView('setup');
    note(labels.cleared);
    greet();
    setPet('idle');
    focusInput();
  };

  async function submit(event) {
    event?.preventDefault();
    const text = draft().trim();
    if (text === '' || busy() || noteBusy() || pending() !== null) return;
    if (view() === 'setup') return saveApiKey(text);
    if (view() === 'locked' && !(await unlock())) return;
    const picked = scopes();
    const quoted = quote();
    add({ role: 'user', text, quote: quoted, scopes: picked.map((scope) => scope.label) });
    setDraft('');
    setQuote(null);
    setScopes([]);
    run({ content: quoted === null ? text : `${quoted.replace(/^/gm, '> ')}\n\n${text}`, scopes: picked, bubble: { text, quote: quoted, scopes: picked.map((scope) => scope.label) } });
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
        system: systemPrompt({ page: await contextPage(catalog), catalog, scopes: picked, sources, rules: prompts().chat ?? builtInPrompts.chat, instructions: prompts().instructions }),
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
    persist();
    if (failure === null && latest !== null) setAnnouncement({ text: replyText(latest.content, root) });
    setPet(failure !== null ? 'failed' : controller.signal.aborted ? 'idle' : 'answered');
    setBusy(false);
  }

  const retryable = (id) => !busy() && !noteBusy() && pending() === null && messages.at(-1)?.id === id;
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

  const lastReply = () => finished().at(-1)?.id;
  const noteCurrent = () => studyNote() !== null && studyNote().versions.at(-1).rounds === finished().length;
  const noteAction = () => (view() === 'setup' || busy() || noteBusy() || pending() !== null ? null : noteCurrent() ? { label: labels.viewNote, run: openNote } : { label: labels.makeNote, run: () => summarize() });
  function openNote() {
    setPopover(null);
    setNoteHint('');
    setNoteOpen(true);
  }
  const closeNote = () => {
    setNoteOpen(false);
    setRedo(false);
    focusInput();
  };
  const showVersion = (index) => {
    setStudyNote({ ...studyNote(), index });
    setNoteHint('');
  };

  async function summarize(request = null) {
    const rounds = finished().map(storedRound);
    if (rounds.length === 0 || busy() || noteBusy() || pending() !== null || view() === 'setup') return;
    if (view() === 'locked' && !(await unlock())) return;
    const previous = request === null ? null : studyNote().versions[studyNote().index];
    setPopover(null);
    setRedo(false);
    setNoteBusy(true);
    setPet('reading');
    const inCard = noteOpen();
    const progress = inCard ? null : note(labels.summarizing);
    if (!inCard) focusInput();
    if (inCard) {
      setNoteHint(request === null ? labels.summarizing : labels.resummarizing(request));
      setAnnouncement({ text: noteHint() });
    }
    const controller = new AbortController();
    noteAbort = controller;
    try {
      const catalog = await loadCatalog(root).catch(() => Promise.reject(new CatalogError()));
      const context = await contextPage(catalog);
      const own = ownArticle(root, catalog, article(), context);
      const known = own === null || catalog.articles.includes(own.entry) ? catalog : { ...catalog, articles: [...catalog.articles, own.entry] };
      const cited = citedEntries(root, known, rounds, own?.entry.url).slice(0, MAX_NOTE_SOURCES);
      const sources = await Promise.all(cited.map(async (entry) => ({ entry, source: (await readArticle(root, known, `/${entry.url}`)).content })));
      const { message } = await complete({
        key: apiKey,
        messages: notePrompt({ catalog, own, sources, rounds, labels, previous: previous?.markdown ?? null, request, rules: prompts().note ?? builtInPrompts.note, instructions: prompts().instructions }),
        tools: [],
        thinking: thinking(),
        signal: controller.signal,
      });
      const checked = checkNote(message.content, { root, catalog: known, base: article()?.address });
      if (checked.markdown === '') throw new EmptyNote();
      setStudyNote(addNoteVersion(studyNote(), { markdown: checked.markdown, articles: checked.articles, rounds: rounds.length, request, date: localDate() }));
      persist();
      if (progress !== null && present(progress)) remove(progress);
      setNoteHint('');
      setNoteOpen(true);
      setAnnouncement({ text: labels.noteReady });
      setPet('answered');
    } catch (error) {
      if (controller.signal.aborted) return;
      const text = error instanceof EmptyNote ? labels.noteEmpty : requestProblem(error, labels);
      setPet('failed');
      if (progress !== null && present(progress)) {
        remove(progress);
        problem(text);
      } else {
        setNoteHint(text);
        setAnnouncement({ text });
      }
    } finally {
      if (noteAbort === controller) {
        noteAbort = null;
        setNoteBusy(false);
      }
    }
  }

  const ask = async (range) => {
    const article = page.article?.element;
    const selected = article === null || article === undefined ? null : await selectionMarkdown(range, article);
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
  const activeScope = () => Math.min(active(), visibleScopes().length - 1);
  const scopeGroups = () => {
    const shown = visibleScopes().map((scope, index) => ({ scope, index }));
    return [...new Set(shown.map(({ scope }) => scope.kind))].map((kind) => ({ kind, items: shown.filter(({ scope }) => scope.kind === kind) }));
  };
  const listing = () => query() !== null && options() !== null;
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
    if (event.key === 'Escape' && query() !== null && !composing(event)) {
      event.preventDefault();
      event.stopPropagation();
      setQuery(null);
      return;
    }
    if (event.key === 'Backspace' && input.selectionStart === 0 && input.selectionEnd === 0) {
      if (scopes().length > 0) setScopes(scopes().slice(0, -1));
      else if (quote() !== null) setQuote(null);
    }
    if (event.key === 'Enter' && !composing(event)) submit(event);
  };
  const containerKeydown = (event) => {
    if (event.key !== 'Escape' || composing(event)) return;
    event.preventDefault();
    if (popover() !== null) {
      setPopover(null);
      focusInput();
    } else if (redo()) setRedo(false);
    else if (noteOpen()) closeNote();
    else hide();
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
      if (popover() !== null && !path.some((element) => element instanceof Element && element.classList.contains('bk-chat-pop-area'))) setPopover(null);
      return;
    }
    hide({ focus: false });
  };
  const escape = (event) => {
    if (event.key === 'Escape' && open() && !event.defaultPrevented && !composing(event)) hide();
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
    <section class="bk-chat" data-open={open() ? '' : undefined} data-note={noteOpen() ? '' : undefined} role="dialog" aria-label={labels.title} aria-hidden={String(!open())} ref={container} on:keydown={containerKeydown} on:transitionend={hidden}>
      <p class="bk-chat-status" role="status">
        <Show when={announcement()} keyed>
          {({ text }) => <span>{text}</span>}
        </Show>
      </p>
      <div class="bk-chat-bubbles" data-faded={faded() ? '' : undefined} hidden={noteOpen()} ref={list} onScroll={updateFade}>
        <div class="bk-chat-thread" ref={(element) => resize.observe(element)}>
          <For each={messages}>
            {(message) =>
              message.role === 'user' ? (
                <UserBubble message={message} />
              ) : message.role === 'assistant' ? (
                <Reply
                  message={message}
                  root={root}
                  base={away() ? article().address : undefined}
                  labels={labels}
                  canRetry={retryable(message.id)}
                  onRetry={() => retry(message.id)}
                  noteAction={message.id === lastReply() ? noteAction() : null}
                />
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
      <Show when={noteOpen() && studyNote() !== null}>
        <NoteCard
          labels={labels}
          root={root}
          note={studyNote()}
          article={article()}
          busy={noteBusy()}
          hint={noteHint()}
          setHint={setNoteHint}
          redo={redo()}
          setRedo={setRedo}
          announce={(text) => setAnnouncement({ text })}
          onIndex={showVersion}
          onBack={closeNote}
          onRedo={(request) => summarize(request)}
        />
      </Show>
      <form class="bk-chat-composer" onSubmit={submit}>
        <Show when={listing()}>
          <div class="bk-chat-scopes">
            <Show when={visibleScopes().length > 0} fallback={<p class="bk-chat-scopes-none">{labels.noScope}</p>}>
              <div id="bk-chat-scopes" role="listbox" aria-label={labels.scopes}>
                <For each={scopeGroups()}>
                  {(group) => (
                    <div class="bk-chat-scopes-kind" role="group" aria-labelledby={`bk-chat-kind-${group.kind}`}>
                      <p class="bk-chat-scopes-group" id={`bk-chat-kind-${group.kind}`}>
                        {labels.kinds[group.kind]}
                      </p>
                      <For each={group.items}>
                        {({ scope, index }) => (
                          <div
                            class="bk-chat-scope"
                            id={`bk-chat-scope-${index}`}
                            role="option"
                            aria-selected={String(index === activeScope())}
                            ref={(element) => createEffect(() => index === active() && element.scrollIntoView({ block: 'nearest' }))}
                            onPointerDown={(event) => {
                              event.preventDefault();
                              pick(scope);
                            }}
                          >
                            <span>{scope.label}</span>
                            <small>{scope.meta}</small>
                          </div>
                        )}
                      </For>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </Show>
        <Show when={quote() !== null}>
          <span class="bk-chat-chip bk-chat-quote" title={quote()}>
            <span>
              {labels.quoted(quote())}
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
          role={view() === 'setup' ? undefined : 'combobox'}
          aria-autocomplete={view() === 'setup' ? undefined : 'list'}
          aria-expanded={view() === 'setup' ? undefined : String(listing() && visibleScopes().length > 0)}
          aria-controls={view() === 'setup' || !listing() || visibleScopes().length === 0 ? undefined : 'bk-chat-scopes'}
          aria-activedescendant={listing() && visibleScopes().length > 0 ? `bk-chat-scope-${activeScope()}` : undefined}
          onInput={(event) => {
            setDraft(event.currentTarget.value);
            setActive(0);
            readQuery();
          }}
          onClick={readQuery}
          onBlur={() => setQuery(null)}
          on:keydown={keydown}
        />
        <div class="bk-chat-pop-area">
          <button type="button" class="bk-chat-icon" aria-label={labels.history} title={labels.history} aria-expanded={String(popover() === 'history')} onClick={toggleHistory}>
            <svg viewBox="0 0 16 16" aria-hidden="true" data-stroke>
              <circle cx="8" cy="8" r="6" />
              <path d="M8 4.6V8l2.3 1.5" />
            </svg>
          </button>
          <Show when={popover() === 'history'}>
            <HistoryList
              labels={labels}
              home={page.article === null}
              groups={historyGroups(historyItems(), { address: page.address, home: page.article === null })}
              newRef={(element) => (historyNew = element)}
              onNew={newChat}
              onOpen={restore}
              onDelete={forgetConversation}
            />
          </Show>
        </div>
        <div class="bk-chat-pop-area">
          <button type="button" class="bk-chat-icon" aria-label={labels.settings} title={labels.settings} aria-expanded={String(popover() === 'menu')} onClick={() => setPopover(popover() === 'menu' ? null : 'menu')}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="3.5" cy="8" r="1.3" />
              <circle cx="8" cy="8" r="1.3" />
              <circle cx="12.5" cy="8" r="1.3" />
            </svg>
          </button>
          <Show when={popover() === 'prompt'}>
            <PromptForm
              labels={labels}
              prompts={prompts()}
              builtIn={builtInPrompts}
              onCancel={() => {
                setPopover(null);
                focusInput();
              }}
              onSave={(text) => {
                const saved = savePrompts(text, builtInPrompts);
                if (saved === null) return labels.promptStorage;
                setPrompts(saved);
                setPopover(null);
                note(customPrompts(saved) ? labels.promptSaved : labels.promptCleared);
                focusInput();
                return null;
              }}
            />
          </Show>
          <Show when={popover() === 'menu'}>
            <Settings
              labels={labels}
              root={root}
              pet={pet}
              petSource={props.petSource}
              view={view()}
              thinking={thinking()}
              noteAction={finished().length > 0 && view() !== 'setup' ? { label: noteCurrent() ? labels.viewNote : labels.makeNote, run: noteCurrent() ? openNote : () => summarize(), disabled: busy() || noteBusy() || pending() !== null } : null}
              customPrompts={customPrompts(prompts())}
              onPrompt={() => setPopover('prompt')}
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
            <button type="submit" class="bk-chat-send" disabled={draft().trim() === '' || pending() !== null || noteBusy()}>
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

let sitePetRequest = null;

function sitePet(root) {
  sitePetRequest ??= fetch(new URL('_bake/pet/pet.json', root))
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
  return sitePetRequest;
}

function Settings(props) {
  const { labels, root, pet } = props;
  const [address, setAddress] = createSignal(storedReaderPet()?.url ?? '');
  const [status, setStatus] = createSignal(null);
  const [loading, setLoading] = createSignal(false);
  const [chosen, setChosen] = createSignal(storedReaderPet() !== null);
  const [site, setSite] = createSignal(null);
  sitePet(root).then(setSite);

  const use = async () => {
    if (loading() || address().trim() === '') return;
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
      <Show when={props.noteAction}>
        {(action) => (
          <button type="button" class="bk-chat-menu-item" disabled={action().disabled} onClick={action().run}>
            {action().label}
          </button>
        )}
      </Show>
      <button type="button" class="bk-chat-menu-item" aria-haspopup="dialog" onClick={props.onPrompt}>
        {labels.prompt}
        <Show when={props.customPrompts}>
          <span class="bk-chat-menu-state">{labels.promptSet}</span>
        </Show>
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
      <div class="bk-chat-pet-form">
        <label>
          <span>{labels.pet}</span>
          <input
            type="url"
            name="pet"
            value={address()}
            placeholder={labels.petAddress}
            aria-label={labels.petAddress}
            spellcheck={false}
            onInput={(event) => setAddress(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.isComposing) return;
              event.preventDefault();
              use();
            }}
          />
        </label>
        <button type="button" class="bk-chat-menu-button" disabled={loading() || address().trim() === ''} onClick={use}>
          {labels.petUse}
        </button>
      </div>
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

const PROMPT_TABS = ['instructions', 'chat', 'note'];

function PromptForm(props) {
  const { labels } = props;
  const [problem, setProblem] = createSignal(null);
  const [tab, setTab] = createSignal('instructions');
  const fields = {};
  const tabs = {};
  onMount(() => {
    const field = fields.instructions;
    field.focus({ preventScroll: true });
    field.setSelectionRange(field.value.length, field.value.length);
  });
  const save = (event) => {
    event?.preventDefault();
    setProblem(props.onSave({ instructions: fields.instructions.value, chat: fields.chat.value, note: fields.note.value }));
  };
  const choose = (name) => {
    setTab(name);
    tabs[name].focus();
  };
  return (
    <form class="bk-chat-pop bk-chat-prompt" role="dialog" aria-label={labels.promptTitle} onSubmit={save}>
      <div class="bk-chat-prompt-tabs" role="tablist" aria-label={labels.promptTitle}>
        <For each={PROMPT_TABS}>
          {(name, index) => (
            <button
              type="button"
              role="tab"
              id={`bk-chat-prompt-tab-${name}`}
              aria-controls={`bk-chat-prompt-panel-${name}`}
              aria-selected={String(tab() === name)}
              tabindex={tab() === name ? 0 : -1}
              ref={(element) => (tabs[name] = element)}
              onClick={() => setTab(name)}
              on:keydown={(event) => {
                const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
                if (step === undefined) return;
                event.preventDefault();
                choose(PROMPT_TABS[(index() + step + PROMPT_TABS.length) % PROMPT_TABS.length]);
              }}
            >
              {labels.promptTabs[name]}
            </button>
          )}
        </For>
      </div>
      <For each={PROMPT_TABS}>
        {(name) => (
          <div class="bk-chat-prompt-panel" role="tabpanel" id={`bk-chat-prompt-panel-${name}`} aria-labelledby={`bk-chat-prompt-tab-${name}`} hidden={tab() !== name}>
            <textarea
              id={name === 'instructions' ? 'bk-chat-prompt-text' : `bk-chat-prompt-${name}`}
              rows="4"
              data-built-in={name === 'instructions' ? undefined : ''}
              maxlength={name === 'instructions' ? MAX_INSTRUCTIONS : MAX_RULES}
              aria-labelledby={`bk-chat-prompt-tab-${name}`}
              placeholder={name === 'instructions' ? labels.promptPlaceholder : undefined}
              value={name === 'instructions' ? props.prompts.instructions : (props.prompts[name] ?? props.builtIn[name])}
              ref={(element) => (fields[name] = element)}
              on:keydown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.isComposing) save(event);
              }}
            />
          </div>
        )}
      </For>
      <p class="bk-chat-prompt-hint" role={problem() === null ? undefined : 'alert'} data-failed={problem() === null ? undefined : ''}>
        {problem() ?? labels.promptHints[tab()]}
      </p>
      <div class="bk-chat-redo-actions">
        <button
          type="button"
          class="bk-chat-note-button"
          onClick={() => {
            const field = fields[tab()];
            field.value = tab() === 'instructions' ? '' : props.builtIn[tab()];
            field.focus();
          }}
        >
          {tab() === 'instructions' ? labels.promptClear : labels.promptReset}
        </button>
        <span class="bk-chat-prompt-gap" />
        <button type="button" class="bk-chat-note-button" onClick={props.onCancel}>
          {labels.cancel}
        </button>
        <button type="submit" class="bk-chat-note-button" data-primary>
          {labels.promptSave}
        </button>
      </div>
    </form>
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
    body.innerHTML = replyHtml(props.message.content, { root, base: props.base });
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
      <Show when={props.noteAction}>
        {(action) => (
          <button type="button" class="bk-chat-note-link" onClick={action().run}>
            {action().label}
          </button>
        )}
      </Show>
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

function replyText(content, root) {
  const element = document.createElement('div');
  element.innerHTML = replyHtml(content, { root });
  for (const math of element.querySelectorAll(`.${MATH_CLASS}`)) math.textContent = math.dataset.tex;
  return element.textContent.trim();
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

class EmptyNote extends Error {}

function ownArticle(root, catalog, article, context) {
  if (article === null || context.article === null) return null;
  const entry = catalogEntry(root, catalog, article.address) ?? { url: article.address.slice(1), title: article.title, tags: [], sections: outlineSections(context.article.outline) };
  return { entry, source: context.article.source };
}

function outlineSections(outline) {
  const sections = [];
  for (const heading of outline) {
    if (heading.depth === 2) sections.push({ id: heading.id, number: String(sections.length + 1).padStart(2, '0'), title: heading.title, subsections: [] });
    else sections.at(-1)?.subsections.push({ id: heading.id, title: heading.title });
  }
  return sections;
}

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
