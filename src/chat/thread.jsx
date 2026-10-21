import { For, Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { replyHtml } from './reply.js';
import { typesetMath } from './typeset.js';

export function Thread(props) {
  const { labels } = props;
  const [faded, setFaded] = createSignal(false);
  let list;
  const updateFade = () => {
    const fade = list.scrollHeight - list.clientHeight + list.scrollTop > 2;
    if (faded() !== fade) setFaded(fade);
  };
  createEffect(() => {
    if (props.messages.length > 0 && list !== undefined) list.scrollTop = 0;
  });
  const resize = new ResizeObserver(() => list && updateFade());
  onCleanup(() => resize.disconnect());

  return (
    <div class="bk-chat-bubbles" data-faded={faded() ? '' : undefined} hidden={props.hidden} ref={list} onScroll={updateFade}>
      <div class="bk-chat-thread" ref={(element) => resize.observe(element)}>
        <For each={props.messages}>
          {(message) =>
            message.role === 'user' ? (
              <UserBubble message={message} />
            ) : message.role === 'assistant' ? (
              <Reply
                message={message}
                root={props.root}
                base={props.base}
                labels={labels}
                canRetry={props.canRetry(message.id)}
                onRetry={() => props.onRetry(message.id)}
                noteAction={props.noteAction(message.id)}
              />
            ) : message.role === 'problem' ? (
              <p class="bk-chat-bubble bk-chat-problem" role="alert">
                {message.text}
                <Show when={message.retry !== null && props.canRetry(message.id)}>
                  {' '}
                  <button type="button" class="bk-chat-link" onClick={() => props.onRetryProblem(message.id)}>
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
