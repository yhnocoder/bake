export const STORAGE_KEY = 'bk-chat-key';

const KEY_INFO = new TextEncoder().encode('bake chat api key');
const SALT_BYTES = 32;
const IV_BYTES = 12;

export class VaultError extends Error {
  constructor(reason, cause) {
    super(reason, { cause });
    this.reason = reason;
  }
}

const IP_ADDRESS = /^(?:[\d.]+|\[.*\])$/;

export async function passkeysAvailable() {
  if (!isSecureContext || IP_ADDRESS.test(location.hostname) || typeof PublicKeyCredential === 'undefined' || navigator.credentials === undefined) return false;
  if (typeof PublicKeyCredential.getClientCapabilities !== 'function') return false;
  try {
    return (await PublicKeyCredential.getClientCapabilities())['extension:prf'] === true;
  } catch {
    return false;
  }
}

export function storedKey() {
  try {
    const record = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return ['credential', 'salt', 'iv', 'data'].every((field) => typeof record?.[field] === 'string') ? record : null;
  } catch {
    return null;
  }
}

export async function saveKey(apiKey, { site }) {
  const salt = randomBytes(SALT_BYTES);
  const credential = await passkey(() =>
    navigator.credentials.create({
      publicKey: {
        rp: { name: site },
        user: { id: randomBytes(16), name: `${site} · DeepSeek API key`, displayName: `${site} · DeepSeek API key` },
        challenge: randomBytes(32),
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
        hints: ['client-device'],
        extensions: { prf: { eval: { first: salt } } },
      },
    }),
  );
  const id = encode(credential.rawId);
  const prf = credential.getClientExtensionResults().prf;
  let secret;
  try {
    if (prf?.enabled !== true && prf?.results === undefined) throw new VaultError('unsupported');
    secret = prf.results?.first ?? (await evaluate(id, salt));
  } catch (error) {
    forgetCredential(id);
    throw error;
  }
  const previous = storedKey();
  const sealed = await sealKey(secret, apiKey);
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ credential: id, salt: encode(salt), ...sealed }));
  if (previous !== null && previous.credential !== id) forgetCredential(previous.credential);
}

export async function unlockKey() {
  const record = storedKey();
  if (record === null) throw new VaultError('missing');
  const secret = await evaluate(record.credential, decode(record.salt));
  try {
    return await openKey(secret, record);
  } catch (error) {
    throw new VaultError('corrupt', error);
  }
}

export function clearKey() {
  const record = storedKey();
  localStorage.removeItem(STORAGE_KEY);
  if (record !== null) forgetCredential(record.credential);
}

function forgetCredential(id) {
  if (typeof PublicKeyCredential.signalUnknownCredential !== 'function') return;
  PublicKeyCredential.signalUnknownCredential({ rpId: location.hostname, credentialId: id }).catch(() => {});
}

export async function sealKey(secret, apiKey) {
  const iv = randomBytes(IV_BYTES);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(secret, ['encrypt']), new TextEncoder().encode(apiKey));
  return { iv: encode(iv), data: encode(data) };
}

export async function openKey(secret, { iv, data }) {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(iv) }, await aesKey(secret, ['decrypt']), decode(data));
  return new TextDecoder().decode(plain);
}

async function evaluate(id, salt) {
  const assertion = await passkey(() =>
    navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        allowCredentials: [{ type: 'public-key', id: decode(id) }],
        userVerification: 'required',
        hints: ['client-device'],
        extensions: { prf: { eval: { first: salt } } },
      },
    }),
  );
  const first = assertion.getClientExtensionResults().prf?.results?.first;
  if (first === undefined) throw new VaultError('unsupported');
  return first;
}

async function passkey(request) {
  try {
    const credential = await request();
    if (credential === null) throw new VaultError('cancelled');
    return credential;
  } catch (error) {
    if (error instanceof VaultError) throw error;
    throw new VaultError(error?.name === 'NotAllowedError' || error?.name === 'AbortError' ? 'cancelled' : 'failed', error);
  }
}

async function aesKey(secret, usages) {
  const material = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(), info: KEY_INFO }, material, { name: 'AES-GCM', length: 256 }, false, usages);
}

function randomBytes(count) {
  return crypto.getRandomValues(new Uint8Array(count));
}

function encode(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

function decode(text) {
  const base64 = text.replaceAll('-', '+').replaceAll('_', '/');
  return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')), (char) => char.charCodeAt(0));
}
