import { For, Show, createEffect, createSignal, onMount } from 'solid-js';
import { exportMarkdown, markdownText, noteFileName, noteHtml, noteTitle } from './note.js';
import { typesetMath } from './typeset.js';

export function NoteCard(props) {
  const { labels, root } = props;
  const [raw, setRaw] = createSignal(false);
  let body;
  let source;
  let redoButton;
  let request;
  let previous;
  let next;
  let card;

  const version = () => props.note.versions[props.note.index];
  const intro = (href) => labels.noteFrom(version().date, props.article === null ? null : { title: markdownText(props.article.title), href: href(props.article.address) });
  const exported = () => exportMarkdown(version().markdown, { root, intro: intro((address) => new URL(address.slice(1), root).href) });
  const fileName = () => noteFileName(noteTitle(version().markdown) ?? labels.note);

  createEffect(() => {
    const current = version();
    body.innerHTML = noteHtml(current.markdown, {
      root,
      citedFrom: labels.citedFrom,
      intro: [intro((address) => address), current.request === null ? null : labels.noteRequest(markdownText(current.request))],
    });
    typesetMath(body);
  });
  onMount(() => requestAnimationFrame(() => card.isConnected && card.focus({ preventScroll: true })));
  createEffect(() => {
    if (props.redo) request.focus({ preventScroll: true });
  });

  const tell = (text) => {
    props.setHint(text);
    props.announce(text);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exported());
      tell(labels.copied);
    } catch {
      setRaw(true);
      source.focus({ preventScroll: true });
      getSelection().selectAllChildren(source);
      tell(labels.copyBlocked);
    }
  };
  const download = () => {
    const name = fileName();
    const address = URL.createObjectURL(new Blob([exported()], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = address;
    link.download = name;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(address), 1000);
    tell(labels.downloaded(name));
  };
  const turn = (step, button, other) => {
    props.onIndex(props.note.index + step);
    if (button.disabled) other.focus({ preventScroll: true });
  };
  const closeRedo = () => {
    props.setRedo(false);
    redoButton.focus({ preventScroll: true });
  };
  const submit = (event) => {
    event.preventDefault();
    const text = request.value.trim();
    if (text === '') {
      request.placeholder = labels.redoEmpty;
      request.focus();
      return;
    }
    request.value = '';
    request.placeholder = labels.redoPlaceholder;
    card.focus({ preventScroll: true });
    props.onRedo(text);
  };
  const choose = (chip) => {
    const text = request.value.trim();
    request.value = text === '' ? chip.insert : `${text}${labels.redoJoin}${chip.insert}`;
    request.focus();
    request.setSelectionRange(request.value.length, request.value.length);
  };

  return (
    <div class="bk-chat-note-card" role="region" aria-label={labels.note} tabindex="-1" ref={card}>
      <div class="bk-chat-note-head">
        <button type="button" class="bk-chat-note-tab" aria-label={labels.noteBackLabel} onClick={props.onBack}>
          {labels.noteBack}
        </button>
        <span class="bk-chat-note-label">{labels.noteHead(version().rounds, version().articles)}</span>
        <Show when={props.note.versions.length > 1}>
          <button type="button" class="bk-chat-note-version" aria-label={labels.previousVersion} disabled={props.note.index === 0} ref={previous} onClick={() => turn(-1, previous, next)}>
            ‹
          </button>
          <span class="bk-chat-note-count">{labels.version(props.note.index + 1, props.note.versions.length)}</span>
          <button type="button" class="bk-chat-note-version" aria-label={labels.nextVersion} disabled={props.note.index === props.note.versions.length - 1} ref={next} onClick={() => turn(1, next, previous)}>
            ›
          </button>
        </Show>
        <button type="button" class="bk-chat-note-tab" aria-pressed={String(raw())} onClick={() => setRaw(!raw())}>
          Markdown
        </button>
      </div>
      <div class="bk-chat-note-body" tabindex="0" hidden={raw()} data-busy={props.busy ? '' : undefined} ref={body} />
      <pre class="bk-chat-note-source" tabindex="0" hidden={!raw()} ref={source}>
        {exported()}
      </pre>
      <div class="bk-chat-note-foot">
        <button type="button" class="bk-chat-note-button" data-primary onClick={copy}>
          {labels.copyMarkdown}
        </button>
        <button type="button" class="bk-chat-note-button" onClick={download}>
          {labels.download}
        </button>
        <button type="button" class="bk-chat-note-button" aria-haspopup="dialog" aria-expanded={String(props.redo)} disabled={props.busy} ref={redoButton} onClick={() => (props.redo ? closeRedo() : props.setRedo(true))}>
          {labels.resummarize}
        </button>
        <span class="bk-chat-note-hint">{props.hint}</span>
      </div>
      <form class="bk-chat-redo" role="dialog" aria-label={labels.resummarize} data-open={props.redo ? '' : undefined} inert={!props.redo} onSubmit={submit}>
        <label for="bk-chat-redo-request">{labels.redoTitle}</label>
        <textarea
          id="bk-chat-redo-request"
          rows="2"
          placeholder={labels.redoPlaceholder}
          ref={request}
          on:keydown={(event) => {
            if (event.isComposing || event.keyCode === 229) return;
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              closeRedo();
            } else if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form.requestSubmit();
            }
          }}
        />
        <div class="bk-chat-redo-chips">
          <For each={labels.redoChips}>
            {(chip) => (
              <button type="button" class="bk-chat-redo-chip" onClick={() => choose(chip)}>
                {chip.text}
              </button>
            )}
          </For>
        </div>
        <div class="bk-chat-redo-actions">
          <button type="button" class="bk-chat-note-button" onClick={closeRedo}>
            {labels.cancel}
          </button>
          <button type="submit" class="bk-chat-note-button" data-primary>
            {labels.resummarize}
          </button>
        </div>
      </form>
    </div>
  );
}
