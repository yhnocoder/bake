import { For, Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { composing } from '../keys.js';
import { loadCatalog, matchingScopes, scopeOptions } from './context.js';

const SCOPE_QUERY = /@([^\s@]*)$/;

export function QuestionField(props) {
  const { labels, root } = props;
  const [options, setOptions] = createSignal(null);
  const [query, setQuery] = createSignal(null);
  const [active, setActive] = createSignal(0);
  let input;

  createEffect(() => props.open || setQuery(null));

  const readQuery = () => {
    if (input === undefined || props.view === 'setup') return setQuery(null);
    const match = input.value.slice(0, input.selectionStart ?? input.value.length).match(SCOPE_QUERY);
    setQuery(match === null ? null : match[1]);
    if (match !== null && options() === null) {
      loadCatalog(root).then(
        (catalog) => setOptions(scopeOptions(catalog, labels)),
        () => setOptions([]),
      );
    }
  };
  const visibleScopes = () => (query() === null || options() === null ? [] : matchingScopes(options(), query(), props.scopes));
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
    props.setDraft(value);
    input.value = value;
    input.setSelectionRange(start, start);
    props.setScopes([...props.scopes, scope]);
    setActive(0);
    readQuery();
  };
  const removeScope = (scope) => {
    props.setScopes(props.scopes.filter((item) => item.id !== scope.id));
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
      if ((event.key === 'Enter' || event.key === 'Tab') && !composing(event)) {
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
      if (props.scopes.length > 0) props.setScopes(props.scopes.slice(0, -1));
      else if (props.quote !== null) props.setQuote(null);
    }
    if (event.key === 'Enter' && !composing(event)) props.onSubmit(event);
  };

  const wideScreen = matchMedia('(min-width: 1000px)');
  const [wide, setWide] = createSignal(wideScreen.matches);
  const followWidth = () => setWide(wideScreen.matches);
  wideScreen.addEventListener('change', followWidth);
  onCleanup(() => wideScreen.removeEventListener('change', followWidth));
  const placeholder = () => {
    const texts = wide() ? labels.placeholder : labels.shortPlaceholder;
    return props.view === 'setup' ? texts.key : props.scopes.length > 0 ? texts.scoped : texts[props.home ? 'blog' : 'article'];
  };

  return (
    <>
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
      <Show when={props.quote !== null}>
        <span class="bk-chat-chip bk-chat-quote" title={props.quote}>
          <span>{labels.quoted(props.quote)}</span>
          <button type="button" aria-label={labels.removeQuote} onClick={() => props.setQuote(null)}>
            ✕
          </button>
        </span>
      </Show>
      <For each={props.scopes}>
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
        ref={(element) => {
          input = element;
          props.ref(element);
        }}
        type={props.view === 'setup' ? 'password' : 'text'}
        name={props.view === 'setup' ? 'key' : 'question'}
        autocomplete="off"
        spellcheck={props.view !== 'setup'}
        value={props.draft}
        placeholder={placeholder()}
        aria-label={props.view === 'setup' ? labels.placeholder.key : labels.question}
        role={props.view === 'setup' ? undefined : 'combobox'}
        aria-autocomplete={props.view === 'setup' ? undefined : 'list'}
        aria-expanded={props.view === 'setup' ? undefined : String(listing() && visibleScopes().length > 0)}
        aria-controls={props.view === 'setup' || !listing() || visibleScopes().length === 0 ? undefined : 'bk-chat-scopes'}
        aria-activedescendant={listing() && visibleScopes().length > 0 ? `bk-chat-scope-${activeScope()}` : undefined}
        onInput={(event) => {
          props.setDraft(event.currentTarget.value);
          setActive(0);
          readQuery();
        }}
        onClick={readQuery}
        onBlur={() => setQuery(null)}
        on:keydown={keydown}
      />
    </>
  );
}
