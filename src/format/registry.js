export function createRegistry(builtinBlocks, blogBlocks = []) {
  const registry = new Map();
  for (const block of [...builtinBlocks, ...blogBlocks]) {
    if (registry.has(block.name)) throw new Error(`Duplicate block type ${block.name}`);
    registry.set(block.name, block);
  }
  return registry;
}
