export const API = 'https://api.deepseek.com';
export const MODEL = 'deepseek-flash';

const DATA = 'data:';
const DONE = '[DONE]';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function checkKey(key, { fetch = globalThis.fetch, signal } = {}) {
  const response = await fetch(`${API}/models`, { headers: { authorization: `Bearer ${key}` }, signal });
  if (!response.ok) throw await apiError(response);
}

export async function complete({ key, messages, tools, toolChoice = 'auto', thinking, signal, fetch = globalThis.fetch, onDelta = () => {} }) {
  const body = {
    model: MODEL,
    messages,
    stream: true,
    thinking: { type: thinking ? 'enabled' : 'disabled' },
    ...(tools.length === 0 ? {} : { tools, tool_choice: toolChoice }),
  };
  const response = await fetch(`${API}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw await apiError(response);
  const message = { role: 'assistant', content: '', reasoning_content: '', tool_calls: [] };
  let finish = null;
  for await (const chunk of readEvents(response.body)) {
    const choice = chunk.choices?.[0];
    if (choice === undefined) continue;
    const { delta = {} } = choice;
    if (typeof delta.reasoning_content === 'string') message.reasoning_content += delta.reasoning_content;
    if (typeof delta.content === 'string') message.content += delta.content;
    for (const call of delta.tool_calls ?? []) addToolCall(message.tool_calls, call);
    if (choice.finish_reason) finish = choice.finish_reason;
    onDelta(message);
  }
  if (message.tool_calls.length === 0) delete message.tool_calls;
  return { message, finish };
}

export async function* readEvents(stream) {
  let buffer = '';
  for await (const text of stream.pipeThrough(new TextDecoderStream())) {
    buffer += text;
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      const event = eventOf(line);
      if (event === DONE) return;
      if (event !== null) yield event;
    }
  }
  const event = eventOf(buffer);
  if (event !== null && event !== DONE) yield event;
}

function eventOf(line) {
  const text = line.trim();
  if (!text.startsWith(DATA)) return null;
  const data = text.slice(DATA.length).trim();
  return data === DONE ? DONE : JSON.parse(data);
}

function addToolCall(calls, delta) {
  const call = (calls[delta.index] ??= { id: '', type: 'function', function: { name: '', arguments: '' } });
  if (delta.id) call.id = delta.id;
  if (delta.function?.name) call.function.name += delta.function.name;
  if (delta.function?.arguments) call.function.arguments += delta.function.arguments;
}

async function apiError(response) {
  const text = await response.text().catch(() => '');
  let message = text;
  try {
    message = JSON.parse(text).error?.message ?? text;
  } catch {}
  return new ApiError(response.status, message || response.statusText);
}
