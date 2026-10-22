import { Show, createSignal, onCleanup } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import { render } from 'solid-js/web';
import { selectionMarkdown } from '../copy/copy.js';
import { composing } from '../shared/keys.js';
import styles from './bubbles.css?inline';
import { CHAT_RULES, READ_ARTICLE, articlePage, chatTools, currentPage, loadCatalog, readArticle, systemPrompt } from './context.js';
import { answer } from './conversation.js';
import { checkKey, complete } from './deepseek.js';
import { addNoteVersion, localDate, roundMessages, saveConversation, storedRound } from './history.js';
import { HistoryArea } from './history-area.jsx';
import { customPrompts, readPrompts, savePrompts } from './instructions.js';
import { NoteCard } from './note-card.jsx';
import { MAX_NOTE_SOURCES, checkNote, citedEntries, notePrompt, noteRules, ownArticle } from './note.js';
import { CatalogError, EmptyNote, requestProblem, vaultProblem } from './problems.js';
import { PromptForm } from './prompt-form.jsx';
import { QuestionField } from './question-field.jsx';
import { replyText } from './reply.js';
import { SettingsMenu } from './settings-menu.jsx';
import { Thread } from './thread.jsx';
import { VaultError, clearKey, rememberedKey, saveKey, storedKey, unlockKey } from './vault.js';

const THINKING_KEY = 'bk-chat-thinking';
const DEEPSEEK_KEYS = 'https://platform.deepseek.com/api_keys';

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
  const [quote, setQuote] = createSignal(null);
  const [draft, setDraft] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [pending, setPending] = createSignal(null);
  const [popover, setPopover] = createSignal(null);
  const [thinking, setThinking] = createSignal(readThinking());
  const [announcement, setAnnouncement] = createSignal(null);
  const pageArticle = () => (page.article === null ? null : { address: page.address, title: page.title });
  const [article, setArticle] = createSignal(pageArticle());
  const [studyNote, setStudyNote] = createSignal(null);
  const [noteOpen, setNoteOpen] = createSignal(false);
  const [noteBusy, setNoteBusy] = createSignal(false);
  const [noteHint, setNoteHint] = createSignal('');
  const [redo, setRedo] = createSignal(false);
  const builtInPrompts = { chat: CHAT_RULES, note: noteRules(labels) };
  const [prompts, setPrompts] = createSignal(readPrompts());
  let conversationId = crypto.randomUUID();
  let awayPage = null;
  let apiKey = null;
  let abort = null;
  let noteAbort = null;
  let lastId = 0;
  let unlockTried = false;
  let remembering = null;
  let activity = 'idle';
  let container;
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

  const show = () => {
    if (open()) return;
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
    if (noteOpen() || redo()) closeNoteAfterFade();
    launcher.setAttribute('aria-expanded', 'false');
    pet.setState('idle');
    if (focus) launcher.focus({ preventScroll: true });
  };
  const toggle = () => (open() ? hide() : show());
  const closeNoteAfterFade = () => {
    if (open()) return;
    const fade = container.getAnimations({ subtree: true }).find((animation) => animation.effect?.pseudoElement === '::before' && animation.transitionProperty === 'opacity');
    if (fade !== undefined) {
      fade.finished.then(closeNoteAfterFade, closeNoteAfterFade);
      return;
    }
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
  document.addEventListener('pointerdown', outside);
  document.addEventListener('keydown', escape);
  onCleanup(() => {
    document.removeEventListener('pointerdown', outside);
    document.removeEventListener('keydown', escape);
  });

  props.ref({ toggle, ask, readPage: () => (page = currentPage(root)) });

  return (
    <section class="bk-chat" data-open={open() ? '' : undefined} data-note={noteOpen() ? '' : undefined} role="dialog" aria-label={labels.title} aria-hidden={String(!open())} ref={container} on:keydown={containerKeydown}>
      <p class="bk-chat-status" role="status">
        <Show when={announcement()} keyed>
          {({ text }) => <span>{text}</span>}
        </Show>
      </p>
      <Thread
        labels={labels}
        root={root}
        messages={messages}
        hidden={noteOpen()}
        base={away() ? article().address : undefined}
        canRetry={retryable}
        onRetry={retry}
        onRetryProblem={retryProblem}
        noteAction={(id) => (id === lastReply() ? noteAction() : null)}
      />
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
        <QuestionField
          ref={input}
          labels={labels}
          root={root}
          view={view()}
          open={open()}
          home={page.article === null}
          draft={draft()}
          setDraft={setDraft}
          quote={quote()}
          setQuote={setQuote}
          scopes={scopes()}
          setScopes={setScopes}
          onSubmit={submit}
        />
        <HistoryArea
          labels={labels}
          root={root}
          open={popover() === 'history'}
          onToggle={(shown) => setPopover(shown ? 'history' : null)}
          current={() => conversationId}
          address={page.address}
          home={page.article === null}
          onNew={newChat}
          onOpen={restore}
        />
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
            <SettingsMenu
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

function readThinking() {
  try {
    return localStorage.getItem(THINKING_KEY) === 'on';
  } catch {
    return false;
  }
}

