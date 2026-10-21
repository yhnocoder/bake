import { For, Show, createSignal, onMount } from 'solid-js';
import { composing } from '../keys.js';
import { MAX_INSTRUCTIONS, MAX_RULES } from './instructions.js';

const PROMPT_TABS = ['instructions', 'chat', 'note'];

export function PromptForm(props) {
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
              <For each={labels.promptTabs[name]}>
                {(part, index) => (
                  <>
                    <Show when={index() > 0}>
                      <wbr />
                    </Show>
                    {part}
                  </>
                )}
              </For>
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
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !composing(event)) save(event);
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
