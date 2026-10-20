import { For, Show } from 'solid-js';
import { localDate } from './history.js';

export function HistoryList(props) {
  const { labels } = props;
  const day = (date) => {
    const today = localDate();
    if (date === today) return labels.today;
    return date.slice(0, 4) === today.slice(0, 4) ? date.slice(5) : date;
  };
  return (
    <div class="bk-chat-pop bk-chat-history" role="dialog" aria-label={labels.history}>
      <button type="button" class="bk-chat-history-new" ref={props.newRef} onClick={props.onNew}>
        ＋ {labels.newChat}
      </button>
      <Show when={props.groups.length > 0} fallback={<p class="bk-chat-history-empty">{labels.historyEmpty[props.home ? 'blog' : 'article']}</p>}>
        <For each={props.groups}>
          {(group) => {
            const name = group.article === null ? labels.wholeBlog : labels.articleGroup(group.article.title);
            return (
              <div class="bk-chat-history-group" role="group" aria-label={props.home ? name : undefined}>
                <Show when={props.home}>
                  <p class="bk-chat-history-name" aria-hidden="true">
                    {name}
                  </p>
                </Show>
                <For each={group.items}>
                  {(item) => (
                    <div class="bk-chat-history-row">
                      <button type="button" class="bk-chat-history-open" onClick={() => props.onOpen(item)}>
                        <span class="bk-chat-history-title">{item.rounds[0].ask.bubble.text}</span>
                        <Show when={item.note !== null}>
                          <span class="bk-chat-badge">{labels.note}</span>
                        </Show>
                        <small>
                          {day(item.date)} · {labels.rounds(item.rounds.length)}
                        </small>
                      </button>
                      <button type="button" class="bk-chat-history-delete" aria-label={labels.deleteConversation} title={labels.deleteConversation} onClick={() => props.onDelete(item)}>
                        <svg viewBox="0 0 10 10" aria-hidden="true">
                          <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" />
                        </svg>
                      </button>
                    </div>
                  )}
                </For>
              </div>
            );
          }}
        </For>
      </Show>
      <p class="bk-chat-history-foot">{labels.historyFoot}</p>
    </div>
  );
}
