import { complete } from './deepseek.js';

export const MAX_TOOL_ROUNDS = 6;

export async function answer({ key, system, history, tools, runTool, thinking, signal, fetch, onUpdate = () => {} }) {
  const added = [];
  const turn = { reasoning: '', content: '', reads: [] };
  const update = () => onUpdate({ reasoning: turn.reasoning, content: turn.content, reads: turn.reads.map((read) => ({ ...read })) });
  for (let round = 0; ; round += 1) {
    const before = { reasoning: turn.reasoning, content: joined(turn.content) };
    const { message, finish } = await complete({
      key,
      messages: [{ role: 'system', content: system }, ...history, ...added],
      tools,
      toolChoice: round < MAX_TOOL_ROUNDS ? 'auto' : 'none',
      thinking,
      signal,
      fetch,
      onDelta: (partial) => {
        turn.reasoning = before.reasoning + partial.reasoning_content;
        turn.content = before.content + partial.content;
        update();
      },
    });
    added.push(message);
    if (finish !== 'tool_calls' || message.tool_calls === undefined) return { added, turn };
    for (const call of message.tool_calls) {
      const read = { name: call.function.name, label: null, url: null, failed: false, done: false };
      turn.reads.push(read);
      update();
      const result = await runTool(call.function.name, parseArguments(call.function.arguments));
      Object.assign(read, { label: result.label, url: result.url ?? null, failed: result.failed === true, done: true });
      update();
      added.push({ role: 'tool', tool_call_id: call.id, content: result.content });
    }
  }
}

function joined(content) {
  return content === '' || content.endsWith('\n\n') ? content : `${content}\n\n`;
}

function parseArguments(text) {
  try {
    const value = JSON.parse(text || '{}');
    return value !== null && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}
