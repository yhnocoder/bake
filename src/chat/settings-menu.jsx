import { Show, createSignal } from 'solid-js';
import { composing } from '../shared/keys.js';
import { PetError, chooseReaderPet, forgetReaderPet, storedReaderPet } from './reader-pet.js';
import { storedKey } from './vault.js';

let sitePetRequest = null;

function sitePet(root) {
  sitePetRequest ??= fetch(new URL('_bake/pet/pet.json', root))
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
  return sitePetRequest;
}

export function SettingsMenu(props) {
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
              if (event.key !== 'Enter' || composing(event)) return;
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
